/**
 * Lab subject mode: 'physics' | 'chem'
 *
 * Resolution order:
 *  1. ?mode=chem | ?mode=physics query
 *  2. documentElement / body data-lab-mode
 *  3. default 'physics'
 */

export function resolveLabMode(search = typeof location !== 'undefined' ? location.search : '') {
  try {
    const params = new URLSearchParams(search || '');
    const q = String(params.get('mode') || '').toLowerCase().trim();
    if (q === 'chem' || q === 'chemistry' || q === 'huaxue') return 'chem';
    if (q === 'physics' || q === 'wuli') return 'physics';
  } catch { /* ignore */ }

  if (typeof document !== 'undefined') {
    const raw = document.documentElement?.dataset?.labMode
      || document.body?.dataset?.labMode
      || '';
    const d = String(raw).toLowerCase().trim();
    if (d === 'chem' || d === 'chemistry' || d === 'huaxue') return 'chem';
    if (d === 'physics' || d === 'wuli') return 'physics';
  }

  return 'physics';
}

export function isChemMode(mode = resolveLabMode()) {
  return mode === 'chem';
}

export const CHEM_ACCENT = '#0f172a';
export const CHEM_ACCENT_NUM = 0x0f172a;
