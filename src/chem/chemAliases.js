/**
 * 本地化学别名与「混合物 → 纯分子」展开表
 * 解决 AI/商品名无法在 PubChem 命中 3D 结构的问题
 */

/** 中文 / 别名 / 商品名 → PubChem 友好英文名（纯分子） */
export const ALIASES = {
  // 基础
  水: 'water',
  盐: 'sodium chloride',
  食盐: 'sodium chloride',
  甲烷: 'methane',
  乙烷: 'ethane',
  丙烷: 'propane',
  丁烷: 'butane',
  乙烯: 'ethylene',
  乙炔: 'acetylene',
  苯: 'benzene',
  甲苯: 'toluene',
  氨: 'ammonia',
  氨气: 'ammonia',
  二氧化碳: 'carbon dioxide',
  一氧化碳: 'carbon monoxide',
  氧气: 'oxygen',
  氮气: 'nitrogen',
  氢气: 'hydrogen',
  乙醇: 'ethanol',
  酒精: 'ethanol',
  甲醇: 'methanol',
  乙酸: 'acetic acid',
  醋酸: 'acetic acid',
  醋: 'acetic acid',
  丙酮: 'acetone',
  葡萄糖: 'glucose',
  果糖: 'fructose',
  半乳糖: 'galactose',
  蔗糖: 'sucrose',
  乳糖: 'lactose',
  麦芽糖: 'maltose',
  淀粉: 'starch',
  纤维素: 'cellulose',
  咖啡因: 'caffeine',
  阿司匹林: 'aspirin',
  阿斯匹林: 'aspirin',
  胆固醇: 'cholesterol',
  氯化钠: 'sodium chloride',
  硫酸: 'sulfuric acid',
  硝酸: 'nitric acid',
  盐酸: 'hydrochloric acid',
  臭氧: 'ozone',
  过氧化氢: 'hydrogen peroxide',
  双氧水: 'hydrogen peroxide',
  小苏打: 'sodium bicarbonate',
  碳酸氢钠: 'sodium bicarbonate',
  苏打: 'sodium carbonate',
  碳酸钠: 'sodium carbonate',
  铁锈: 'iron(III) oxide',
  氧化铁: 'iron(III) oxide',
  甘油: 'glycerol',
  丙三醇: 'glycerol',
  尿素: 'urea',
  柠檬酸: 'citric acid',
  乳酸: 'lactic acid',
  磷酸: 'phosphoric acid',
  茶碱: 'theophylline',
  尼古丁: 'nicotine',
  辣椒素: 'capsaicin',
  薄荷醇: 'menthol',
  香草醛: 'vanillin',
  谷氨酸钠: 'monosodium glutamate',
  味精: 'monosodium glutamate',
  山梨糖醇: 'sorbitol',
  木糖醇: 'xylitol',
  阿斯巴甜: 'aspartame',
  蔗糖素: 'sucralose',
  安赛蜜: 'acesulfame potassium',
  苯甲酸钠: 'sodium benzoate',
  山梨酸钾: 'potassium sorbate',
  二氧化碳气: 'carbon dioxide',
  碳酸: 'carbonic acid',
  可可碱: 'theobromine',
  棕榈酸: 'palmitic acid',
  油酸: 'oleic acid',
  亚油酸: 'linoleic acid',
  硬脂酸: 'stearic acid',
  甘氨酸: 'glycine',
  精氨酸: 'arginine',
  谷氨酸: 'glutamic acid',

  // 英文商品 / 缩写（映射到可查纯分子）
  hfcs: 'fructose',
  'hfcs-55': 'fructose',
  'hfcs-42': 'fructose',
  msg: 'monosodium glutamate',
  alcohol: 'ethanol',
}

/**
 * 自身是混合物、没有单一 3D 结构的条目 → 拆成可查的纯分子
 * parts[].share 为在该混合物内部的相对质量份额（合计约 100）
 * @type {Record<string, { name_zh: string, name_en: string, formula?: string, smiles?: string, share: number, role?: string }[]>}
 */
export const MIXTURE_EXPAND = {
  // 高果糖玉米糖浆（HFCS-55 典型）
  高果糖玉米糖浆: [
    { name_zh: '果糖', name_en: 'fructose', formula: 'C6H12O6', share: 55, role: '甜味剂' },
    { name_zh: '葡萄糖', name_en: 'glucose', formula: 'C6H12O6', share: 42, role: '甜味剂' },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 3, role: '溶剂' },
  ],
  'high fructose corn syrup': [
    { name_zh: '果糖', name_en: 'fructose', formula: 'C6H12O6', share: 55, role: 'sweetener' },
    { name_zh: '葡萄糖', name_en: 'glucose', formula: 'C6H12O6', share: 42, role: 'sweetener' },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 3, role: 'solvent' },
  ],
  hfcs: [
    { name_zh: '果糖', name_en: 'fructose', formula: 'C6H12O6', share: 55 },
    { name_zh: '葡萄糖', name_en: 'glucose', formula: 'C6H12O6', share: 42 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 3 },
  ],
  玉米糖浆: [
    { name_zh: '葡萄糖', name_en: 'glucose', formula: 'C6H12O6', share: 70 },
    { name_zh: '麦芽糖', name_en: 'maltose', formula: 'C12H22O11', share: 20 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 10 },
  ],
  'corn syrup': [
    { name_zh: '葡萄糖', name_en: 'glucose', formula: 'C6H12O6', share: 70 },
    { name_zh: '麦芽糖', name_en: 'maltose', formula: 'C12H22O11', share: 20 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 10 },
  ],
  蜂蜜: [
    { name_zh: '果糖', name_en: 'fructose', formula: 'C6H12O6', share: 38 },
    { name_zh: '葡萄糖', name_en: 'glucose', formula: 'C6H12O6', share: 31 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 17 },
    { name_zh: '麦芽糖', name_en: 'maltose', formula: 'C12H22O11', share: 7 },
    { name_zh: '蔗糖', name_en: 'sucrose', formula: 'C12H22O11', share: 1 },
  ],
  honey: [
    { name_zh: '果糖', name_en: 'fructose', formula: 'C6H12O6', share: 38 },
    { name_zh: '葡萄糖', name_en: 'glucose', formula: 'C6H12O6', share: 31 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 17 },
  ],
  空气: [
    { name_zh: '氮气', name_en: 'nitrogen', formula: 'N2', smiles: 'N#N', share: 78, role: '主体' },
    { name_zh: '氧气', name_en: 'oxygen', formula: 'O2', smiles: 'O=O', share: 21, role: '氧化剂' },
    { name_zh: '氩气', name_en: 'argon', formula: 'Ar', share: 0.9 },
    { name_zh: '二氧化碳', name_en: 'carbon dioxide', formula: 'CO2', smiles: 'O=C=O', share: 0.04 },
  ],
  air: [
    { name_zh: '氮气', name_en: 'nitrogen', formula: 'N2', smiles: 'N#N', share: 78 },
    { name_zh: '氧气', name_en: 'oxygen', formula: 'O2', smiles: 'O=O', share: 21 },
  ],
  海水: [
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 96.5 },
    { name_zh: '氯化钠', name_en: 'sodium chloride', formula: 'NaCl', share: 2.7 },
    { name_zh: '氯化镁', name_en: 'magnesium chloride', formula: 'MgCl2', share: 0.3 },
  ],
  'sea water': [
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 96.5 },
    { name_zh: '氯化钠', name_en: 'sodium chloride', formula: 'NaCl', share: 2.7 },
  ],
  植物油: [
    { name_zh: '油酸', name_en: 'oleic acid', formula: 'C18H34O2', share: 40 },
    { name_zh: '亚油酸', name_en: 'linoleic acid', formula: 'C18H32O2', share: 30 },
    { name_zh: '棕榈酸', name_en: 'palmitic acid', formula: 'C16H32O2', share: 15 },
  ],
  'vegetable oil': [
    { name_zh: '油酸', name_en: 'oleic acid', formula: 'C18H34O2', share: 40 },
    { name_zh: '亚油酸', name_en: 'linoleic acid', formula: 'C18H32O2', share: 30 },
  ],
  黄油: [
    { name_zh: '棕榈酸', name_en: 'palmitic acid', formula: 'C16H32O2', share: 30 },
    { name_zh: '油酸', name_en: 'oleic acid', formula: 'C18H34O2', share: 25 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 16 },
    { name_zh: '硬脂酸', name_en: 'stearic acid', formula: 'C18H36O2', share: 12 },
  ],
  butter: [
    { name_zh: '棕榈酸', name_en: 'palmitic acid', formula: 'C16H32O2', share: 30 },
    { name_zh: '油酸', name_en: 'oleic acid', formula: 'C18H34O2', share: 25 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 16 },
  ],
  淀粉: [
    { name_zh: '葡萄糖', name_en: 'glucose', formula: 'C6H12O6', share: 100, role: '淀粉单元代表' },
  ],
  starch: [
    { name_zh: '葡萄糖', name_en: 'glucose', formula: 'C6H12O6', share: 100, role: 'starch unit proxy' },
  ],
  蛋白质: [
    { name_zh: '甘氨酸', name_en: 'glycine', formula: 'C2H5NO2', smiles: 'NCC(=O)O', share: 100, role: '氨基酸代表' },
  ],
  protein: [
    { name_zh: '甘氨酸', name_en: 'glycine', formula: 'C2H5NO2', smiles: 'NCC(=O)O', share: 100 },
  ],
  脂肪: [
    { name_zh: '油酸', name_en: 'oleic acid', formula: 'C18H34O2', share: 50 },
    { name_zh: '棕榈酸', name_en: 'palmitic acid', formula: 'C16H32O2', share: 30 },
    { name_zh: '硬脂酸', name_en: 'stearic acid', formula: 'C18H36O2', share: 20 },
  ],
  fat: [
    { name_zh: '油酸', name_en: 'oleic acid', formula: 'C18H34O2', share: 50 },
    { name_zh: '棕榈酸', name_en: 'palmitic acid', formula: 'C16H32O2', share: 30 },
  ],
  食用油: [
    { name_zh: '油酸', name_en: 'oleic acid', formula: 'C18H34O2', share: 45 },
    { name_zh: '亚油酸', name_en: 'linoleic acid', formula: 'C18H32O2', share: 35 },
    { name_zh: '棕榈酸', name_en: 'palmitic acid', formula: 'C16H32O2', share: 12 },
  ],
  糖浆: [
    { name_zh: '蔗糖', name_en: 'sucrose', formula: 'C12H22O11', share: 60 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 40 },
  ],
  syrup: [
    { name_zh: '蔗糖', name_en: 'sucrose', formula: 'C12H22O11', share: 60 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 40 },
  ],
  人造奶油: [
    { name_zh: '棕榈酸', name_en: 'palmitic acid', formula: 'C16H32O2', share: 35 },
    { name_zh: '油酸', name_en: 'oleic acid', formula: 'C18H34O2', share: 30 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 16 },
  ],
  margarine: [
    { name_zh: '棕榈酸', name_en: 'palmitic acid', formula: 'C16H32O2', share: 35 },
    { name_zh: '油酸', name_en: 'oleic acid', formula: 'C18H34O2', share: 30 },
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 16 },
  ],
  牛奶: [
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 87 },
    { name_zh: '乳糖', name_en: 'lactose', formula: 'C12H22O11', share: 4.8 },
    { name_zh: '油酸', name_en: 'oleic acid', formula: 'C18H34O2', share: 1.5 },
    { name_zh: '甘氨酸', name_en: 'glycine', formula: 'C2H5NO2', smiles: 'NCC(=O)O', share: 2.5, role: '蛋白氨基酸代表' },
  ],
  milk: [
    { name_zh: '水', name_en: 'water', formula: 'H2O', smiles: 'O', share: 87 },
    { name_zh: '乳糖', name_en: 'lactose', formula: 'C12H22O11', share: 4.8 },
  ],
}

/** 名称同义 → 更易命中的英文查询词列表（按优先级） */
export const NAME_SYNONYMS = {
  fructose: ['D-fructose', 'levulose', 'fruit sugar'],
  glucose: ['D-glucose', 'dextrose', 'blood sugar'],
  sucrose: ['table sugar', 'saccharose', 'cane sugar'],
  lactose: ['milk sugar', 'D-lactose'],
  maltose: ['malt sugar', 'D-maltose'],
  'sodium chloride': ['table salt', 'NaCl', 'halite'],
  ethanol: ['ethyl alcohol', 'grain alcohol', 'EtOH'],
  'acetic acid': ['ethanoic acid', 'vinegar acid', 'glacial acetic acid'],
  'carbon dioxide': ['CO2', 'carbonic anhydride'],
  caffeine: ['1,3,7-trimethylxanthine', 'guaranine'],
  'iron(III) oxide': ['ferric oxide', 'hematite', 'Fe2O3', 'iron oxide'],
  'sodium bicarbonate': ['baking soda', 'sodium hydrogen carbonate', 'NaHCO3'],
  glycerol: ['glycerin', 'propane-1,2,3-triol'],
  'citric acid': ['2-hydroxypropane-1,2,3-tricarboxylic acid'],
  'phosphoric acid': ['orthophosphoric acid', 'H3PO4'],
  'monosodium glutamate': ['MSG', 'sodium glutamate', 'glutamic acid monosodium salt'],
  casein: ['casein protein'],
  starch: ['amylose', 'amylopectin', 'glucose'],
  cellulose: ['celluose', 'microcrystalline cellulose'],
  'high fructose corn syrup': ['fructose', 'D-fructose', 'glucose'],
  高果糖玉米糖浆: ['fructose', 'D-fructose', 'glucose'],
  果糖: ['fructose', 'D-fructose'],
  葡萄糖: ['glucose', 'D-glucose', 'dextrose'],
  蔗糖: ['sucrose', 'table sugar'],
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function aliasLookup(raw) {
  const q = String(raw || '').trim()
  if (!q) return ''
  const lower = q.toLowerCase()
  return ALIASES[q] || ALIASES[lower] || q
}

/**
 * @param {string} name
 */
export function findMixtureExpand(name) {
  const q = String(name || '').trim()
  if (!q) return null
  const lower = q.toLowerCase()
  return MIXTURE_EXPAND[q] || MIXTURE_EXPAND[lower] || null
}

/**
 * 将成分列表中的「混合物条目」展开为可查纯分子，并按原占比缩放
 * @param {Array<{ name_zh?: string, name_en?: string, formula?: string, smiles?: string, percent?: number, role?: string, id?: string }>} components
 */
export function expandMixtureComponents(components) {
  if (!Array.isArray(components) || !components.length) return []

  /** @type {typeof components} */
  const out = []

  for (const c of components) {
    const keys = [c.name_zh, c.name_en].filter(Boolean)
    let expanded = null
    for (const k of keys) {
      expanded = findMixtureExpand(k)
      if (expanded) break
    }

    if (!expanded) {
      out.push({ ...c })
      continue
    }

    const parentPct = Number(c.percent)
    const base = Number.isFinite(parentPct) && parentPct > 0 ? parentPct : 100
    const shareSum = expanded.reduce((s, p) => s + (Number(p.share) || 0), 0) || 100

    for (const p of expanded) {
      const share = Number(p.share) || 0
      out.push({
        name_zh: p.name_zh,
        name_en: p.name_en,
        formula: p.formula || '',
        smiles: p.smiles || '',
        percent: Math.round(((share / shareSum) * base) * 100) / 100,
        role: p.role || c.role || `来自${c.name_zh || c.name_en}`,
      })
    }
  }

  return mergeSameComponents(out)
}

/**
 * 合并同名成分并重新编号
 * @param {any[]} items
 */
function mergeSameComponents(items) {
  /** @type {Map<string, any>} */
  const map = new Map()

  for (const c of items) {
    const key = (c.name_en || c.formula || c.name_zh || '')
      .toString()
      .toLowerCase()
      .trim()
    if (!key) continue
    if (map.has(key)) {
      const prev = map.get(key)
      prev.percent = (Number(prev.percent) || 0) + (Number(c.percent) || 0)
      if (!prev.smiles && c.smiles) prev.smiles = c.smiles
      if (!prev.formula && c.formula) prev.formula = c.formula
      if (!prev.name_zh && c.name_zh) prev.name_zh = c.name_zh
    } else {
      map.set(key, {
        name_zh: c.name_zh || '',
        name_en: c.name_en || '',
        formula: c.formula || '',
        smiles: c.smiles || '',
        percent: Number(c.percent) || 0,
        role: c.role || '',
      })
    }
  }

  return [...map.values()]
    .map((c) => ({
      ...c,
      percent: Math.round((Number(c.percent) || 0) * 100) / 100,
    }))
    .sort((a, b) => b.percent - a.percent)
    .map((c, i) => ({ ...c, id: `c-${i}` }))
}

/**
 * 为某成分生成尽可能多的 PubChem 查询候选（有序）
 * 顺序：SMILES → 名称/别名/同义词 → 分子式（同分异构体多，放最后）
 * @param {{ name_en?: string, name_zh?: string, formula?: string, smiles?: string }} comp
 * @returns {{ type: 'smiles'|'formula'|'name'|'cid', value: string }[]}
 */
export function buildLookupCandidates(comp) {
  /** @type {{ type: 'smiles'|'formula'|'name'|'cid', value: string }[]} */
  const list = []
  const seen = new Set()

  const push = (type, value) => {
    const v = String(value || '').trim()
    if (!v) return
    const key = `${type}:${v.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    list.push({ type, value: v })
  }

  // 1) 精确结构
  if (comp.smiles) push('smiles', comp.smiles)

  // 2) 名称族（避免果糖/葡萄糖等同分异构体被分子式误匹配）
  const names = []
  if (comp.name_en) names.push(comp.name_en)
  if (comp.name_zh) names.push(comp.name_zh)

  // 展开别名与同义词
  const extra = []
  for (const n of names) {
    const aliased = aliasLookup(n)
    if (aliased && aliased !== n) extra.push(aliased)
    const lower = n.toLowerCase()
    const syns = NAME_SYNONYMS[n] || NAME_SYNONYMS[lower] || []
    for (const s of syns) extra.push(s)
  }
  names.push(...extra)

  for (const n of names) {
    if (/^\d+$/.test(n)) {
      push('cid', n)
      continue
    }
    push('name', n)
    // 仅对纯单糖名加 D- 前缀，避免 "high fructose corn syrup" → "D-high..."
    const base = aliasLookup(n)
    if (/^(glucose|fructose|galactose|lactose|mannose|maltose)$/i.test(base)) {
      push('name', `D-${base}`)
    }
  }

  // 3) 分子式兜底
  if (comp.formula) push('formula', comp.formula.replace(/\s/g, ''))

  return list
}

/** 常见英文名 / IUPAC / 别名 -> 中文映射 */
const EN_TO_ZH = {
  water: '水',
  oxidane: '水',
  h2o: '水',
  'sodium chloride': '氯化钠',
  chlorane: '盐酸',
  methane: '甲烷',
  ethane: '乙烷',
  propane: '丙烷',
  butane: '丁烷',
  ethylene: '乙烯',
  acetylene: '乙炔',
  benzene: '苯',
  toluene: '甲苯',
  ammonia: '氨气',
  azane: '氨气',
  'carbon dioxide': '二氧化碳',
  'carbon monoxide': '一氧化碳',
  oxygen: '氧气',
  dioxygen: '氧气',
  nitrogen: '氮气',
  dinitrogen: '氮气',
  hydrogen: '氢气',
  dihydrogen: '氢气',
  ethanol: '乙醇',
  methanol: '甲醇',
  'acetic acid': '乙酸',
  'ethanoic acid': '乙酸',
  acetone: '丙酮',
  'propan-2-one': '丙酮',
  glucose: '葡萄糖',
  fructose: '果糖',
  galactose: '半乳糖',
  sucrose: '蔗糖',
  lactose: '乳糖',
  maltose: '麦芽糖',
  starch: '淀粉',
  cellulose: '纤维素',
  caffeine: '咖啡因',
  aspirin: '阿司匹林',
  '2-acetoxybenzoic acid': '阿司匹林',
  cholesterol: '胆固醇',
  'sulfuric acid': '硫酸',
  'nitric acid': '硝酸',
  'hydrochloric acid': '盐酸',
  ozone: '臭氧',
  trioxygen: '臭氧',
  'hydrogen peroxide': '过氧化氢',
  dioxidane: '过氧化氢',
  'sodium bicarbonate': '碳酸氢钠',
  'sodium carbonate': '碳酸钠',
  'iron(iii) oxide': '氧化铁',
  glycerol: '甘油',
  'propane-1,2,3-triol': '甘油',
  urea: '尿素',
  'citric acid': '柠檬酸',
  'lactic acid': '乳酸',
  'phosphoric acid': '磷酸',
  theophylline: '茶碱',
  nicotine: '尼古丁',
  capsaicin: '辣椒素',
  menthol: '薄荷醇',
  vanillin: '香草醛',
  'monosodium glutamate': '谷氨酸钠',
  sorbitol: '山梨糖醇',
  xylitol: '木糖醇',
  aspartame: '阿斯巴甜',
  sucralose: '蔗糖素',
  'acesulfame potassium': '安赛蜜',
  'sodium benzoate': '苯甲酸钠',
  'potassium sorbate': '山梨酸钾',
  'carbonic acid': '碳酸',
  theobromine: '可可碱',
  'palmitic acid': '棕榈酸',
  'hexadecanoic acid': '棕榈酸',
  'oleic acid': '油酸',
  'linoleic acid': '亚油酸',
  'stearic acid': '硬脂酸',
  'octadecanoic acid': '硬脂酸',
  glycine: '甘氨酸',
  arginine: '精氨酸',
  'glutamic acid': '谷氨酸',
  solvent: '溶剂',
  solute: '溶质',
  main: '主体',
  primary: '主体',
  sweetener: '甜味剂',
  flavor: '风味剂',
  flavoring: '风味剂',
  preservative: '防腐剂',
  acidulant: '酸度调节剂',
  emulsifier: '乳化剂',
  oxidizer: '氧化剂',
  oxidant: '氧化剂',
}

for (const [zh, en] of Object.entries(ALIASES)) {
  if (typeof en === 'string') {
    EN_TO_ZH[en.toLowerCase()] = zh
  }
}

/**
 * 尝试将英文/IUPAC/分子式名转换为中文
 * @param {string} text
 * @returns {string}
 */
export function toChinese(text) {
  if (!text || typeof text !== 'string') return text || ''
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  if (EN_TO_ZH[lower]) return EN_TO_ZH[lower]
  return trimmed
}

