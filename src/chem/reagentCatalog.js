/**
 * Curated element → common reagent catalog for the chemistry island.
 * Each reagent has a PubChem-friendly query key and a display color.
 *
 * Coverage targets middle/high-school lab chemistry: acids, bases, salts,
 * common organics, gases, and classic demonstration reagents.
 */

/** @typedef {{ id: string, symbol: string, name_zh: string, Z: number, group: number, period: number }} ChemElement */
/** @typedef {{ id: string, formula: string, name_zh: string, color: number, query: string, element: string }} ChemReagent */

const SUB_DIGITS = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
};

/**
 * Format chemical formula numbers to standard subscript notation (e.g. H2O -> H₂O, C8H18 -> C₈H₁₈)
 * @param {string} formula
 * @returns {string}
 */
export function formatSubscriptFormula(formula) {
  if (!formula) return '';
  return String(formula).replace(/([A-Za-z\)])(\d+)/g, (_match, prefix, digits) => {
    const sub = digits.split('').map((d) => SUB_DIGITS[d] || d).join('');
    return prefix + sub;
  });
}

/** Dictionary of common chemical formulas to Chinese names for instant zero-latency local resolution. */
const LOCAL_FORMULA_MAP = new Map([
  ['H2O', '水'],
  ['NACL', '氯化钠'],
  ['NAOH', '氢氧化钠'],
  ['HCL', '盐酸'],
  ['CO2', '二氧化碳'],
  ['H2SO4', '硫酸'],
  ['HNO3', '硝酸'],
  ['H3PO4', '磷酸'],
  ['CUSO4', '硫酸铜'],
  ['KMNO4', '高锰酸钾'],
  ['FE2O3', '氧化铁'],
  ['FESO4', '硫酸亚铁'],
  ['CA(OH)2', '氢氧化钙'],
  ['CACO3', '碳酸钙'],
  ['NH3', '氨气'],
  ['NH4CL', '氯化铵'],
  ['CH4', '甲烷'],
  ['C2H5OH', '乙醇'],
  ['C2H4', '乙烯'],
  ['C2H2', '乙炔'],
  ['C3H8', '丙烷'],
  ['C4H10', '丁烷'],
  ['C6H12', '环己烷'],
  ['C6H6', '苯'],
  ['C7H8', '甲苯'],
  ['C7H16', '庚烷'],
  ['C8H18', '辛烷'],
  ['C12H22O11', '蔗糖'],
  ['O2', '氧气'],
  ['H2', '氢气'],
  ['N2', '氮气'],
  ['CL2', '氯气'],
  ['BR2', '溴水'],
]);

/** Normalize formula casing e.g. 'h2o' -> 'H2O', 'nacl' -> 'NaCl', 'c8h18' -> 'C8H18'. */
export function normalizeFormulaCase(raw) {
  const str = String(raw || '').trim();
  if (!str) return '';
  return str.replace(/([a-zA-Z]+)(\d*)/g, (_m, elems, num) => {
    const formattedElem = elems.replace(/([A-Z][a-z]?)/gi, (sub) => {
      return sub.charAt(0).toUpperCase() + sub.slice(1).toLowerCase();
    });
    return formattedElem + num;
  });
}

/**
 * Check if query is a determined single chemical formula and resolve locally without API call.
 * @param {string} query
 * @returns {{ formula: string, name_zh: string } | null}
 */
export function tryResolveLocalFormula(query) {
  const raw = String(query || '').trim();
  if (!raw) return null;
  // If query contains Chinese characters, '+', '=', or spaces, treat as natural language / reaction
  if (/[\u4e00-\u9fa5\+\=\s]/.test(raw)) return null;

  const normalized = normalizeFormulaCase(raw);
  const key = normalized.toUpperCase();

  const nameZh = LOCAL_FORMULA_MAP.get(key) || getReagent(raw.toLowerCase())?.name_zh || getReagent(normalized.toLowerCase())?.name_zh || normalized;

  // Validate formula regex pattern
  if (/^([A-Z][a-z]?\d*)+$/i.test(normalized) || /^([A-Z][a-z]?\d*|\([A-Z][a-z]?\d*\)\d*)+$/i.test(normalized)) {
    return {
      formula: normalized,
      name_zh: nameZh,
    };
  }
  return null;
}

/** @type {ChemElement[]} */
export const CHEM_ELEMENTS = Object.freeze([
  // Period 1
  { id: 'H', symbol: 'H', name_zh: '氢', Z: 1, group: 1, period: 1 },
  { id: 'He', symbol: 'He', name_zh: '氦', Z: 2, group: 18, period: 1 },
  // Period 2
  { id: 'Li', symbol: 'Li', name_zh: '锂', Z: 3, group: 1, period: 2 },
  { id: 'Be', symbol: 'Be', name_zh: '铍', Z: 4, group: 2, period: 2 },
  { id: 'B', symbol: 'B', name_zh: '硼', Z: 5, group: 13, period: 2 },
  { id: 'C', symbol: 'C', name_zh: '碳', Z: 6, group: 14, period: 2 },
  { id: 'N', symbol: 'N', name_zh: '氮', Z: 7, group: 15, period: 2 },
  { id: 'O', symbol: 'O', name_zh: '氧', Z: 8, group: 16, period: 2 },
  { id: 'F', symbol: 'F', name_zh: '氟', Z: 9, group: 17, period: 2 },
  { id: 'Ne', symbol: 'Ne', name_zh: '氖', Z: 10, group: 18, period: 2 },
  // Period 3
  { id: 'Na', symbol: 'Na', name_zh: '钠', Z: 11, group: 1, period: 3 },
  { id: 'Mg', symbol: 'Mg', name_zh: '镁', Z: 12, group: 2, period: 3 },
  { id: 'Al', symbol: 'Al', name_zh: '铝', Z: 13, group: 13, period: 3 },
  { id: 'Si', symbol: 'Si', name_zh: '硅', Z: 14, group: 14, period: 3 },
  { id: 'P', symbol: 'P', name_zh: '磷', Z: 15, group: 15, period: 3 },
  { id: 'S', symbol: 'S', name_zh: '硫', Z: 16, group: 16, period: 3 },
  { id: 'Cl', symbol: 'Cl', name_zh: '氯', Z: 17, group: 17, period: 3 },
  { id: 'Ar', symbol: 'Ar', name_zh: '氩', Z: 18, group: 18, period: 3 },
  // Period 4
  { id: 'K', symbol: 'K', name_zh: '钾', Z: 19, group: 1, period: 4 },
  { id: 'Ca', symbol: 'Ca', name_zh: '钙', Z: 20, group: 2, period: 4 },
  { id: 'Ti', symbol: 'Ti', name_zh: '钛', Z: 22, group: 4, period: 4 },
  { id: 'Cr', symbol: 'Cr', name_zh: '铬', Z: 24, group: 6, period: 4 },
  { id: 'Mn', symbol: 'Mn', name_zh: '锰', Z: 25, group: 7, period: 4 },
  { id: 'Fe', symbol: 'Fe', name_zh: '铁', Z: 26, group: 8, period: 4 },
  { id: 'Co', symbol: 'Co', name_zh: '钴', Z: 27, group: 9, period: 4 },
  { id: 'Ni', symbol: 'Ni', name_zh: '镍', Z: 28, group: 10, period: 4 },
  { id: 'Cu', symbol: 'Cu', name_zh: '铜', Z: 29, group: 11, period: 4 },
  { id: 'Zn', symbol: 'Zn', name_zh: '锌', Z: 30, group: 12, period: 4 },
  { id: 'Br', symbol: 'Br', name_zh: '溴', Z: 35, group: 17, period: 4 },
  // Period 5
  { id: 'Ag', symbol: 'Ag', name_zh: '银', Z: 47, group: 11, period: 5 },
  { id: 'Sn', symbol: 'Sn', name_zh: '锡', Z: 50, group: 14, period: 5 },
  { id: 'I', symbol: 'I', name_zh: '碘', Z: 53, group: 17, period: 5 },
  // Period 6
  { id: 'Ba', symbol: 'Ba', name_zh: '钡', Z: 56, group: 2, period: 6 },
  { id: 'Pb', symbol: 'Pb', name_zh: '铅', Z: 82, group: 14, period: 6 },
]);

/** @type {Record<string, ChemReagent[]>} */
export const REAGENTS_BY_ELEMENT = Object.freeze({
  H: [
    { id: 'h2', formula: 'H2', name_zh: '氢气', color: 0xe0f2fe, query: 'hydrogen', element: 'H' },
    { id: 'h2o', formula: 'H2O', name_zh: '水', color: 0x38bdf8, query: 'water', element: 'H' },
    { id: 'hcl', formula: 'HCl', name_zh: '盐酸', color: 0xfbbf24, query: 'hydrochloric acid', element: 'H' },
    { id: 'h2so4', formula: 'H2SO4', name_zh: '硫酸', color: 0xf59e0b, query: 'sulfuric acid', element: 'H' },
    { id: 'hno3_h', formula: 'HNO3', name_zh: '硝酸', color: 0xfb7185, query: 'nitric acid', element: 'H' },
    { id: 'h3po4_h', formula: 'H3PO4', name_zh: '磷酸', color: 0xfbbf24, query: 'phosphoric acid', element: 'H' },
    { id: 'h2o2', formula: 'H2O2', name_zh: '过氧化氢', color: 0xa5b4fc, query: 'hydrogen peroxide', element: 'H' },
    { id: 'hf_h', formula: 'HF', name_zh: '氢氟酸', color: 0xa7f3d0, query: 'hydrofluoric acid', element: 'H' },
  ],
  He: [
    { id: 'he', formula: 'He', name_zh: '氦气', color: 0xfce7f3, query: 'helium', element: 'He' },
  ],
  Li: [
    { id: 'li', formula: 'Li', name_zh: '锂', color: 0xd1d5db, query: 'lithium', element: 'Li' },
    { id: 'lioh', formula: 'LiOH', name_zh: '氢氧化锂', color: 0xbbf7d0, query: 'lithium hydroxide', element: 'Li' },
    { id: 'li2co3', formula: 'Li2CO3', name_zh: '碳酸锂', color: 0xfde68a, query: 'lithium carbonate', element: 'Li' },
    { id: 'licl', formula: 'LiCl', name_zh: '氯化锂', color: 0xe2e8f0, query: 'lithium chloride', element: 'Li' },
  ],
  Be: [
    { id: 'beo', formula: 'BeO', name_zh: '氧化铍', color: 0xf5f5f4, query: 'beryllium oxide', element: 'Be' },
    { id: 'becl2', formula: 'BeCl2', name_zh: '氯化铍', color: 0xe7e5e4, query: 'beryllium chloride', element: 'Be' },
  ],
  B: [
    { id: 'h3bo3', formula: 'H3BO3', name_zh: '硼酸', color: 0xfef3c7, query: 'boric acid', element: 'B' },
    { id: 'b2o3', formula: 'B2O3', name_zh: '三氧化二硼', color: 0xfde68a, query: 'boron trioxide', element: 'B' },
    { id: 'nabb4o7', formula: 'Na2B4O7', name_zh: '硼砂', color: 0xfef9c3, query: 'borax', element: 'B' },
  ],
  C: [
    { id: 'c_graphite', formula: 'C', name_zh: '石墨 / 碳', color: 0x57534e, query: 'graphite', element: 'C' },
    { id: 'co2', formula: 'CO2', name_zh: '二氧化碳', color: 0x94a3b8, query: 'carbon dioxide', element: 'C' },
    { id: 'co', formula: 'CO', name_zh: '一氧化碳', color: 0x64748b, query: 'carbon monoxide', element: 'C' },
    { id: 'ch4', formula: 'CH4', name_zh: '甲烷', color: 0xcbd5e1, query: 'methane', element: 'C' },
    { id: 'c2h4', formula: 'C2H4', name_zh: '乙烯', color: 0xa5b4fc, query: 'ethylene', element: 'C' },
    { id: 'c2h2', formula: 'C2H2', name_zh: '乙炔', color: 0xc4b5fd, query: 'acetylene', element: 'C' },
    { id: 'c6h6', formula: 'C6H6', name_zh: '苯', color: 0xfcd34d, query: 'benzene', element: 'C' },
    { id: 'c2h5oh', formula: 'C2H5OH', name_zh: '乙醇', color: 0x67e8f9, query: 'ethanol', element: 'C' },
    { id: 'ch3oh', formula: 'CH3OH', name_zh: '甲醇', color: 0x7dd3fc, query: 'methanol', element: 'C' },
    { id: 'ch3cooh', formula: 'CH3COOH', name_zh: '乙酸', color: 0xfda4af, query: 'acetic acid', element: 'C' },
    { id: 'h2co3', formula: 'H2CO3', name_zh: '碳酸', color: 0xbae6fd, query: 'carbonic acid', element: 'C' },
    { id: 'c6h12o6', formula: 'C6H12O6', name_zh: '葡萄糖', color: 0xfcd34d, query: 'glucose', element: 'C' },
    { id: 'c12h22o11', formula: 'C12H22O11', name_zh: '蔗糖', color: 0xfef08a, query: 'sucrose', element: 'C' },
    { id: 'ch3coch3', formula: 'CH3COCH3', name_zh: '丙酮', color: 0xfbcfe8, query: 'acetone', element: 'C' },
    { id: 'h2nconh2', formula: 'CO(NH2)2', name_zh: '尿素', color: 0xe0e7ff, query: 'urea', element: 'C' },
  ],
  N: [
    { id: 'n2', formula: 'N2', name_zh: '氮气', color: 0x93c5fd, query: 'nitrogen', element: 'N' },
    { id: 'nh3', formula: 'NH3', name_zh: '氨', color: 0xa78bfa, query: 'ammonia', element: 'N' },
    { id: 'hno3', formula: 'HNO3', name_zh: '硝酸', color: 0xfb7185, query: 'nitric acid', element: 'N' },
    { id: 'nano3', formula: 'NaNO3', name_zh: '硝酸钠', color: 0xf9a8d4, query: 'sodium nitrate', element: 'N' },
    { id: 'kno3', formula: 'KNO3', name_zh: '硝酸钾', color: 0xf472b6, query: 'potassium nitrate', element: 'N' },
    { id: 'nh4cl', formula: 'NH4Cl', name_zh: '氯化铵', color: 0xddd6fe, query: 'ammonium chloride', element: 'N' },
    { id: 'nh4no3', formula: 'NH4NO3', name_zh: '硝酸铵', color: 0xfbcfe8, query: 'ammonium nitrate', element: 'N' },
    { id: 'nh4hco3', formula: 'NH4HCO3', name_zh: '碳酸氢铵', color: 0xe9d5ff, query: 'ammonium bicarbonate', element: 'N' },
    { id: 'no2', formula: 'NO2', name_zh: '二氧化氮', color: 0xc2410c, query: 'nitrogen dioxide', element: 'N' },
    { id: 'n2o', formula: 'N2O', name_zh: '一氧化二氮', color: 0xa5b4fc, query: 'nitrous oxide', element: 'N' },
  ],
  O: [
    { id: 'o2', formula: 'O2', name_zh: '氧气', color: 0x7dd3fc, query: 'oxygen', element: 'O' },
    { id: 'o3', formula: 'O3', name_zh: '臭氧', color: 0x38bdf8, query: 'ozone', element: 'O' },
    { id: 'h2o_o', formula: 'H2O', name_zh: '水', color: 0x38bdf8, query: 'water', element: 'O' },
    { id: 'h2o2_o', formula: 'H2O2', name_zh: '过氧化氢', color: 0xa5b4fc, query: 'hydrogen peroxide', element: 'O' },
    { id: 'co2_o', formula: 'CO2', name_zh: '二氧化碳', color: 0x94a3b8, query: 'carbon dioxide', element: 'O' },
  ],
  F: [
    { id: 'f2', formula: 'F2', name_zh: '氟气', color: 0xfde047, query: 'fluorine', element: 'F' },
    { id: 'hf', formula: 'HF', name_zh: '氢氟酸', color: 0xa7f3d0, query: 'hydrofluoric acid', element: 'F' },
    { id: 'naf', formula: 'NaF', name_zh: '氟化钠', color: 0xfef9c3, query: 'sodium fluoride', element: 'F' },
    { id: 'caf2', formula: 'CaF2', name_zh: '氟化钙', color: 0xe0f2fe, query: 'calcium fluoride', element: 'F' },
  ],
  Ne: [
    { id: 'ne', formula: 'Ne', name_zh: '氖气', color: 0xfb7185, query: 'neon', element: 'Ne' },
  ],
  Na: [
    { id: 'na', formula: 'Na', name_zh: '钠', color: 0xd4d4d8, query: 'sodium', element: 'Na' },
    { id: 'nacl', formula: 'NaCl', name_zh: '氯化钠', color: 0xe2e8f0, query: 'sodium chloride', element: 'Na' },
    { id: 'naoh', formula: 'NaOH', name_zh: '氢氧化钠', color: 0x86efac, query: 'sodium hydroxide', element: 'Na' },
    { id: 'na2co3', formula: 'Na2CO3', name_zh: '碳酸钠', color: 0xfdba74, query: 'sodium carbonate', element: 'Na' },
    { id: 'nahco3', formula: 'NaHCO3', name_zh: '碳酸氢钠', color: 0xfde68a, query: 'sodium bicarbonate', element: 'Na' },
    { id: 'na2so4', formula: 'Na2SO4', name_zh: '硫酸钠', color: 0xfef08a, query: 'sodium sulfate', element: 'Na' },
    { id: 'na2s', formula: 'Na2S', name_zh: '硫化钠', color: 0xfef3c7, query: 'sodium sulfide', element: 'Na' },
    { id: 'nano2', formula: 'NaNO2', name_zh: '亚硝酸钠', color: 0xf9a8d4, query: 'sodium nitrite', element: 'Na' },
    { id: 'nach3coo', formula: 'CH3COONa', name_zh: '乙酸钠', color: 0xfda4af, query: 'sodium acetate', element: 'Na' },
    { id: 'na2o2', formula: 'Na2O2', name_zh: '过氧化钠', color: 0xfca5a5, query: 'sodium peroxide', element: 'Na' },
  ],
  Mg: [
    { id: 'mg', formula: 'Mg', name_zh: '镁', color: 0xd4d4d8, query: 'magnesium', element: 'Mg' },
    { id: 'mgo', formula: 'MgO', name_zh: '氧化镁', color: 0xf5f5f4, query: 'magnesium oxide', element: 'Mg' },
    { id: 'mgso4', formula: 'MgSO4', name_zh: '硫酸镁', color: 0xc4b5fd, query: 'magnesium sulfate', element: 'Mg' },
    { id: 'mgcl2', formula: 'MgCl2', name_zh: '氯化镁', color: 0x99f6e4, query: 'magnesium chloride', element: 'Mg' },
    { id: 'mgco3', formula: 'MgCO3', name_zh: '碳酸镁', color: 0xe7e5e4, query: 'magnesium carbonate', element: 'Mg' },
    { id: 'mgoh2', formula: 'Mg(OH)2', name_zh: '氢氧化镁', color: 0xd9f99d, query: 'magnesium hydroxide', element: 'Mg' },
  ],
  Al: [
    { id: 'al', formula: 'Al', name_zh: '铝', color: 0xd4d4d8, query: 'aluminum', element: 'Al' },
    { id: 'alcl3', formula: 'AlCl3', name_zh: '氯化铝', color: 0xd4d4d8, query: 'aluminum chloride', element: 'Al' },
    { id: 'al2o3', formula: 'Al2O3', name_zh: '氧化铝', color: 0xfafafa, query: 'aluminum oxide', element: 'Al' },
    { id: 'al2so43', formula: 'Al2(SO4)3', name_zh: '硫酸铝', color: 0xe0e7ff, query: 'aluminum sulfate', element: 'Al' },
    { id: 'aloh3', formula: 'Al(OH)3', name_zh: '氢氧化铝', color: 0xf1f5f9, query: 'aluminum hydroxide', element: 'Al' },
    { id: 'kals04', formula: 'KAl(SO4)2', name_zh: '明矾', color: 0xddd6fe, query: 'alum', element: 'Al' },
  ],
  Si: [
    { id: 'si', formula: 'Si', name_zh: '硅', color: 0x78716c, query: 'silicon', element: 'Si' },
    { id: 'sio2', formula: 'SiO2', name_zh: '二氧化硅', color: 0xe7e5e4, query: 'silicon dioxide', element: 'Si' },
    { id: 'sicl4', formula: 'SiCl4', name_zh: '四氯化硅', color: 0xd6d3d1, query: 'silicon tetrachloride', element: 'Si' },
    { id: 'h4sio4', formula: 'H4SiO4', name_zh: '原硅酸', color: 0xf5f5f4, query: 'silicic acid', element: 'Si' },
  ],
  P: [
    { id: 'p4', formula: 'P4', name_zh: '白磷', color: 0xfef08a, query: 'white phosphorus', element: 'P' },
    { id: 'p2o5', formula: 'P2O5', name_zh: '五氧化二磷', color: 0xfde68a, query: 'phosphorus pentoxide', element: 'P' },
    { id: 'h3po4', formula: 'H3PO4', name_zh: '磷酸', color: 0xfbbf24, query: 'phosphoric acid', element: 'P' },
    { id: 'caph2po42', formula: 'Ca(H2PO4)2', name_zh: '磷酸二氢钙', color: 0xfef3c7, query: 'calcium dihydrogen phosphate', element: 'P' },
    { id: 'na3po4', formula: 'Na3PO4', name_zh: '磷酸钠', color: 0xfde047, query: 'sodium phosphate', element: 'P' },
  ],
  S: [
    { id: 's8', formula: 'S', name_zh: '硫', color: 0xfacc15, query: 'sulfur', element: 'S' },
    { id: 'so2', formula: 'SO2', name_zh: '二氧化硫', color: 0xfde047, query: 'sulfur dioxide', element: 'S' },
    { id: 'so3', formula: 'SO3', name_zh: '三氧化硫', color: 0xfbbf24, query: 'sulfur trioxide', element: 'S' },
    { id: 'h2so4_s', formula: 'H2SO4', name_zh: '硫酸', color: 0xf59e0b, query: 'sulfuric acid', element: 'S' },
    { id: 'h2s', formula: 'H2S', name_zh: '硫化氢', color: 0xa3e635, query: 'hydrogen sulfide', element: 'S' },
    { id: 'na2so4_s', formula: 'Na2SO4', name_zh: '硫酸钠', color: 0xfef08a, query: 'sodium sulfate', element: 'S' },
    { id: 'na2so3', formula: 'Na2SO3', name_zh: '亚硫酸钠', color: 0xfef9c3, query: 'sodium sulfite', element: 'S' },
    { id: 'cuso4_s', formula: 'CuSO4', name_zh: '硫酸铜', color: 0x2563eb, query: 'copper sulfate', element: 'S' },
  ],
  Cl: [
    { id: 'cl2', formula: 'Cl2', name_zh: '氯气', color: 0x84cc16, query: 'chlorine', element: 'Cl' },
    { id: 'hcl_cl', formula: 'HCl', name_zh: '盐酸', color: 0xfbbf24, query: 'hydrochloric acid', element: 'Cl' },
    { id: 'nacl_cl', formula: 'NaCl', name_zh: '氯化钠', color: 0xe2e8f0, query: 'sodium chloride', element: 'Cl' },
    { id: 'cacl2', formula: 'CaCl2', name_zh: '氯化钙', color: 0xbae6fd, query: 'calcium chloride', element: 'Cl' },
    { id: 'kcl_cl', formula: 'KCl', name_zh: '氯化钾', color: 0xe0e7ff, query: 'potassium chloride', element: 'Cl' },
    { id: 'fecl3_cl', formula: 'FeCl3', name_zh: '氯化铁', color: 0xea580c, query: 'iron(III) chloride', element: 'Cl' },
    { id: 'nacio', formula: 'NaClO', name_zh: '次氯酸钠', color: 0xbef264, query: 'sodium hypochlorite', element: 'Cl' },
    { id: 'hclo', formula: 'HClO', name_zh: '次氯酸', color: 0xd9f99d, query: 'hypochlorous acid', element: 'Cl' },
  ],
  Ar: [
    { id: 'ar', formula: 'Ar', name_zh: '氩气', color: 0xc4b5fd, query: 'argon', element: 'Ar' },
  ],
  K: [
    { id: 'k', formula: 'K', name_zh: '钾', color: 0xc4b5fd, query: 'potassium', element: 'K' },
    { id: 'kcl', formula: 'KCl', name_zh: '氯化钾', color: 0xe0e7ff, query: 'potassium chloride', element: 'K' },
    { id: 'koh', formula: 'KOH', name_zh: '氢氧化钾', color: 0x6ee7b7, query: 'potassium hydroxide', element: 'K' },
    { id: 'kmno4', formula: 'KMnO4', name_zh: '高锰酸钾', color: 0xa21caf, query: 'potassium permanganate', element: 'K' },
    { id: 'k2cr2o7', formula: 'K2Cr2O7', name_zh: '重铬酸钾', color: 0xdc2626, query: 'potassium dichromate', element: 'K' },
    { id: 'k2co3', formula: 'K2CO3', name_zh: '碳酸钾', color: 0xfdba74, query: 'potassium carbonate', element: 'K' },
    { id: 'kno3_k', formula: 'KNO3', name_zh: '硝酸钾', color: 0xf472b6, query: 'potassium nitrate', element: 'K' },
    { id: 'ki_k', formula: 'KI', name_zh: '碘化钾', color: 0xc4b5fd, query: 'potassium iodide', element: 'K' },
    { id: 'k2so4', formula: 'K2SO4', name_zh: '硫酸钾', color: 0xfef08a, query: 'potassium sulfate', element: 'K' },
  ],
  Ca: [
    { id: 'ca', formula: 'Ca', name_zh: '钙', color: 0xd4d4d8, query: 'calcium', element: 'Ca' },
    { id: 'cao', formula: 'CaO', name_zh: '氧化钙', color: 0xf5f5f4, query: 'calcium oxide', element: 'Ca' },
    { id: 'caoh2', formula: 'Ca(OH)2', name_zh: '氢氧化钙', color: 0xd9f99d, query: 'calcium hydroxide', element: 'Ca' },
    { id: 'cacl2_ca', formula: 'CaCl2', name_zh: '氯化钙', color: 0xbae6fd, query: 'calcium chloride', element: 'Ca' },
    { id: 'caco3', formula: 'CaCO3', name_zh: '碳酸钙', color: 0xf5f5f4, query: 'calcium carbonate', element: 'Ca' },
    { id: 'caso4', formula: 'CaSO4', name_zh: '硫酸钙', color: 0xfafaf9, query: 'calcium sulfate', element: 'Ca' },
    { id: 'cah2', formula: 'CaH2', name_zh: '氢化钙', color: 0xe2e8f0, query: 'calcium hydride', element: 'Ca' },
    { id: 'cac2', formula: 'CaC2', name_zh: '电石', color: 0x78716c, query: 'calcium carbide', element: 'Ca' },
  ],
  Ti: [
    { id: 'ti', formula: 'Ti', name_zh: '钛', color: 0xa1a1aa, query: 'titanium', element: 'Ti' },
    { id: 'tio2', formula: 'TiO2', name_zh: '二氧化钛', color: 0xf8fafc, query: 'titanium dioxide', element: 'Ti' },
    { id: 'ticl4', formula: 'TiCl4', name_zh: '四氯化钛', color: 0xd4d4d8, query: 'titanium tetrachloride', element: 'Ti' },
  ],
  Cr: [
    { id: 'cr', formula: 'Cr', name_zh: '铬', color: 0xa3a3a3, query: 'chromium', element: 'Cr' },
    { id: 'cr2o3', formula: 'Cr2O3', name_zh: '三氧化二铬', color: 0x16a34a, query: 'chromium(III) oxide', element: 'Cr' },
    { id: 'k2cr2o7_cr', formula: 'K2Cr2O7', name_zh: '重铬酸钾', color: 0xdc2626, query: 'potassium dichromate', element: 'Cr' },
    { id: 'k2cro4', formula: 'K2CrO4', name_zh: '铬酸钾', color: 0xeab308, query: 'potassium chromate', element: 'Cr' },
    { id: 'crcl3', formula: 'CrCl3', name_zh: '氯化铬', color: 0x22c55e, query: 'chromium(III) chloride', element: 'Cr' },
  ],
  Mn: [
    { id: 'mn', formula: 'Mn', name_zh: '锰', color: 0xa8a29e, query: 'manganese', element: 'Mn' },
    { id: 'mno2', formula: 'MnO2', name_zh: '二氧化锰', color: 0x44403c, query: 'manganese dioxide', element: 'Mn' },
    { id: 'kmno4_mn', formula: 'KMnO4', name_zh: '高锰酸钾', color: 0xa21caf, query: 'potassium permanganate', element: 'Mn' },
    { id: 'mnso4', formula: 'MnSO4', name_zh: '硫酸锰', color: 0xd8b4fe, query: 'manganese(II) sulfate', element: 'Mn' },
    { id: 'mncl2', formula: 'MnCl2', name_zh: '氯化锰', color: 0xc4b5fd, query: 'manganese(II) chloride', element: 'Mn' },
  ],
  Fe: [
    { id: 'fe', formula: 'Fe', name_zh: '铁', color: 0x78716c, query: 'iron', element: 'Fe' },
    { id: 'fe2o3', formula: 'Fe2O3', name_zh: '氧化铁', color: 0xb91c1c, query: 'iron(III) oxide', element: 'Fe' },
    { id: 'fe3o4', formula: 'Fe3O4', name_zh: '四氧化三铁', color: 0x1c1917, query: 'iron(II,III) oxide', element: 'Fe' },
    { id: 'fecl3', formula: 'FeCl3', name_zh: '氯化铁', color: 0xea580c, query: 'iron(III) chloride', element: 'Fe' },
    { id: 'fecl2', formula: 'FeCl2', name_zh: '氯化亚铁', color: 0x65a30d, query: 'iron(II) chloride', element: 'Fe' },
    { id: 'fes04', formula: 'FeSO4', name_zh: '硫酸亚铁', color: 0x65a30d, query: 'iron(II) sulfate', element: 'Fe' },
    { id: 'fe2so43', formula: 'Fe2(SO4)3', name_zh: '硫酸铁', color: 0xf97316, query: 'iron(III) sulfate', element: 'Fe' },
    { id: 'fes', formula: 'FeS', name_zh: '硫化亚铁', color: 0x57534e, query: 'iron(II) sulfide', element: 'Fe' },
  ],
  Co: [
    { id: 'co_metal', formula: 'Co', name_zh: '钴', color: 0x6366f1, query: 'cobalt', element: 'Co' },
    { id: 'cocl2', formula: 'CoCl2', name_zh: '氯化钴', color: 0x2563eb, query: 'cobalt(II) chloride', element: 'Co' },
    { id: 'coso4', formula: 'CoSO4', name_zh: '硫酸钴', color: 0x818cf8, query: 'cobalt(II) sulfate', element: 'Co' },
    { id: 'cono32', formula: 'Co(NO3)2', name_zh: '硝酸钴', color: 0xa5b4fc, query: 'cobalt(II) nitrate', element: 'Co' },
  ],
  Ni: [
    { id: 'ni', formula: 'Ni', name_zh: '镍', color: 0xa3a3a3, query: 'nickel', element: 'Ni' },
    { id: 'nicl2', formula: 'NiCl2', name_zh: '氯化镍', color: 0x22c55e, query: 'nickel(II) chloride', element: 'Ni' },
    { id: 'niso4', formula: 'NiSO4', name_zh: '硫酸镍', color: 0x4ade80, query: 'nickel(II) sulfate', element: 'Ni' },
    { id: 'nino32', formula: 'Ni(NO3)2', name_zh: '硝酸镍', color: 0x86efac, query: 'nickel(II) nitrate', element: 'Ni' },
  ],
  Cu: [
    { id: 'cu', formula: 'Cu', name_zh: '铜', color: 0xb45309, query: 'copper', element: 'Cu' },
    { id: 'cuo', formula: 'CuO', name_zh: '氧化铜', color: 0x1e293b, query: 'copper(II) oxide', element: 'Cu' },
    { id: 'cu2o', formula: 'Cu2O', name_zh: '氧化亚铜', color: 0xdc2626, query: 'copper(I) oxide', element: 'Cu' },
    { id: 'cuso4', formula: 'CuSO4', name_zh: '硫酸铜', color: 0x2563eb, query: 'copper sulfate', element: 'Cu' },
    { id: 'cucl2', formula: 'CuCl2', name_zh: '氯化铜', color: 0x22c55e, query: 'copper(II) chloride', element: 'Cu' },
    { id: 'cuno32', formula: 'Cu(NO3)2', name_zh: '硝酸铜', color: 0x3b82f6, query: 'copper(II) nitrate', element: 'Cu' },
    { id: 'cuoh2', formula: 'Cu(OH)2', name_zh: '氢氧化铜', color: 0x60a5fa, query: 'copper(II) hydroxide', element: 'Cu' },
    { id: 'cus', formula: 'CuS', name_zh: '硫化铜', color: 0x0f172a, query: 'copper(II) sulfide', element: 'Cu' },
  ],
  Zn: [
    { id: 'zn', formula: 'Zn', name_zh: '锌', color: 0xa1a1aa, query: 'zinc', element: 'Zn' },
    { id: 'zno', formula: 'ZnO', name_zh: '氧化锌', color: 0xf8fafc, query: 'zinc oxide', element: 'Zn' },
    { id: 'zncl2', formula: 'ZnCl2', name_zh: '氯化锌', color: 0xd4d4d8, query: 'zinc chloride', element: 'Zn' },
    { id: 'znso4', formula: 'ZnSO4', name_zh: '硫酸锌', color: 0xa1a1aa, query: 'zinc sulfate', element: 'Zn' },
    { id: 'znno32', formula: 'Zn(NO3)2', name_zh: '硝酸锌', color: 0xcbd5e1, query: 'zinc nitrate', element: 'Zn' },
    { id: 'zns', formula: 'ZnS', name_zh: '硫化锌', color: 0xe2e8f0, query: 'zinc sulfide', element: 'Zn' },
  ],
  Br: [
    { id: 'br2', formula: 'Br2', name_zh: '溴', color: 0xb91c1c, query: 'bromine', element: 'Br' },
    { id: 'hbr', formula: 'HBr', name_zh: '氢溴酸', color: 0xfca5a5, query: 'hydrobromic acid', element: 'Br' },
    { id: 'nabr', formula: 'NaBr', name_zh: '溴化钠', color: 0xfecaca, query: 'sodium bromide', element: 'Br' },
    { id: 'kbr', formula: 'KBr', name_zh: '溴化钾', color: 0xfda4af, query: 'potassium bromide', element: 'Br' },
    { id: 'agbr', formula: 'AgBr', name_zh: '溴化银', color: 0xfef3c7, query: 'silver bromide', element: 'Br' },
  ],
  Ag: [
    { id: 'ag', formula: 'Ag', name_zh: '银', color: 0xe5e7eb, query: 'silver', element: 'Ag' },
    { id: 'agno3', formula: 'AgNO3', name_zh: '硝酸银', color: 0xf8fafc, query: 'silver nitrate', element: 'Ag' },
    { id: 'agcl', formula: 'AgCl', name_zh: '氯化银', color: 0xf1f5f9, query: 'silver chloride', element: 'Ag' },
    { id: 'agbr_ag', formula: 'AgBr', name_zh: '溴化银', color: 0xfef3c7, query: 'silver bromide', element: 'Ag' },
    { id: 'agi', formula: 'AgI', name_zh: '碘化银', color: 0xfde68a, query: 'silver iodide', element: 'Ag' },
    { id: 'ag2o', formula: 'Ag2O', name_zh: '氧化银', color: 0x57534e, query: 'silver oxide', element: 'Ag' },
  ],
  Sn: [
    { id: 'sn', formula: 'Sn', name_zh: '锡', color: 0xd4d4d8, query: 'tin', element: 'Sn' },
    { id: 'sncl2', formula: 'SnCl2', name_zh: '氯化亚锡', color: 0xe7e5e4, query: 'tin(II) chloride', element: 'Sn' },
    { id: 'sncl4', formula: 'SnCl4', name_zh: '四氯化锡', color: 0xd6d3d1, query: 'tin(IV) chloride', element: 'Sn' },
    { id: 'sno2', formula: 'SnO2', name_zh: '二氧化锡', color: 0xfafaf9, query: 'tin(IV) oxide', element: 'Sn' },
  ],
  I: [
    { id: 'i2', formula: 'I2', name_zh: '碘', color: 0x6b21a8, query: 'iodine', element: 'I' },
    { id: 'ki', formula: 'KI', name_zh: '碘化钾', color: 0xc4b5fd, query: 'potassium iodide', element: 'I' },
    { id: 'nai', formula: 'NaI', name_zh: '碘化钠', color: 0xddd6fe, query: 'sodium iodide', element: 'I' },
    { id: 'hi', formula: 'HI', name_zh: '氢碘酸', color: 0xa78bfa, query: 'hydroiodic acid', element: 'I' },
    { id: 'agi_i', formula: 'AgI', name_zh: '碘化银', color: 0xfde68a, query: 'silver iodide', element: 'I' },
  ],
  Ba: [
    { id: 'ba', formula: 'Ba', name_zh: '钡', color: 0xa1a1aa, query: 'barium', element: 'Ba' },
    { id: 'bacl2', formula: 'BaCl2', name_zh: '氯化钡', color: 0xe0e7ff, query: 'barium chloride', element: 'Ba' },
    { id: 'baoh2', formula: 'Ba(OH)2', name_zh: '氢氧化钡', color: 0xd9f99d, query: 'barium hydroxide', element: 'Ba' },
    { id: 'baso4', formula: 'BaSO4', name_zh: '硫酸钡', color: 0xf8fafc, query: 'barium sulfate', element: 'Ba' },
    { id: 'bano32', formula: 'Ba(NO3)2', name_zh: '硝酸钡', color: 0xfbcfe8, query: 'barium nitrate', element: 'Ba' },
    { id: 'baco3', formula: 'BaCO3', name_zh: '碳酸钡', color: 0xf1f5f9, query: 'barium carbonate', element: 'Ba' },
  ],
  Pb: [
    { id: 'pb', formula: 'Pb', name_zh: '铅', color: 0x71717a, query: 'lead', element: 'Pb' },
    { id: 'pbno32', formula: 'Pb(NO3)2', name_zh: '硝酸铅', color: 0xfafafa, query: 'lead(II) nitrate', element: 'Pb' },
    { id: 'pbo', formula: 'PbO', name_zh: '氧化铅', color: 0xfbbf24, query: 'lead(II) oxide', element: 'Pb' },
    { id: 'pbo2', formula: 'PbO2', name_zh: '二氧化铅', color: 0x57534e, query: 'lead dioxide', element: 'Pb' },
    { id: 'pbs', formula: 'PbS', name_zh: '硫化铅', color: 0x1c1917, query: 'lead(II) sulfide', element: 'Pb' },
    { id: 'pbso4', formula: 'PbSO4', name_zh: '硫酸铅', color: 0xf5f5f4, query: 'lead(II) sulfate', element: 'Pb' },
  ],
});

/**
 * Compact grid positions for the curated set (period, group → cell).
 * Uses standard 18-column layout so transition metals and noble gases align.
 */
export function elementGridCell(el) {
  const groupCol = {
    1: 0,
    2: 1,
    3: 2,
    4: 3,
    5: 4,
    6: 5,
    7: 6,
    8: 7,
    9: 8,
    10: 9,
    11: 10,
    12: 11,
    13: 12,
    14: 13,
    15: 14,
    16: 15,
    17: 16,
    18: 17,
  };
  return {
    col: groupCol[el.group] ?? Math.min(17, Math.max(0, el.group - 1)),
    row: el.period - 1,
  };
}

export function getElement(symbol) {
  return CHEM_ELEMENTS.find((e) => e.id === symbol || e.symbol === symbol) || null;
}

export function getReagentsForElement(symbol) {
  return REAGENTS_BY_ELEMENT[symbol] || [];
}

export function getReagent(id) {
  for (const list of Object.values(REAGENTS_BY_ELEMENT)) {
    const hit = list.find((r) => r.id === id);
    if (hit) return hit;
  }
  return null;
}

/** All reagents flattened (first id wins if duplicates across elements). */
export function listAllReagents() {
  const seen = new Set();
  const out = [];
  for (const list of Object.values(REAGENTS_BY_ELEMENT)) {
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

/** Blend two hex colors by weight in [0,1]. */
export function blendColors(a, b, t = 0.5) {
  const u = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const bl = Math.round(ab + (bb - ab) * u);
  return (r << 16) | (g << 8) | bl;
}
