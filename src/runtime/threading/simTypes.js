/**
 * Shared constants for ExperimentSimBackend (Phase 2+).
 *
 * Snapshot buffers are latest-complete-wins: main applies the newest even
 * generation; odd generation means a write is in flight.
 */

/** Particle layout: px, py, pz, vx, vy, vz */
export const PARTICLE_STRIDE_POS_VEL = 6;
/** Particle layout: px, py, pz, vx, vy, vz, temp */
export const PARTICLE_STRIDE_POS_VEL_TEMP = 7;
/** Packed field-line polyline: [count, n0, x,y,z…, n1, x,y,z…] */
export const FIELD_LINE_HEADER = 1;

export const SIM_KIND = Object.freeze({
  // Thermo
  CALORIMETRY_MIX: 'thermo.calorimetryMix',
  HEAT_CONDUCTION: 'thermo.heatConduction',
  IDEAL_GAS: 'thermo.idealGas',
  CONVECTION: 'thermo.convection',
  // Electro
  ELECTRIC_FIELD_LINES: 'electro.electricFieldLines',
  HALL_CARRIERS: 'electro.hallCarriers',
  GAUSS_METRICS: 'electro.gaussMetrics',
  // Optics
  DIFFRACTION_FRINGE: 'optics.diffractionFringe',
  GEOMETRIC_ANGLES: 'optics.geometricAngles',
});

/**
 * Resolve sim backend mode.
 * Host: globalThis.__SIM_BACKEND_MODE__ = 'worker' | 'main' | 'auto'
 * Default auto (prefer worker, fall back main) — same policy as physics.
 * @param {{ mode?: string }} [options]
 * @returns {'main' | 'worker' | 'auto'}
 */
export function resolveSimMode(options = {}) {
  const raw = options.mode
    ?? (typeof globalThis !== 'undefined' ? globalThis.__SIM_BACKEND_MODE__ : null)
    ?? 'auto';
  if (raw === 'worker' || raw === 'auto' || raw === 'main') return raw;
  return 'auto';
}

/**
 * Preferred compute worker slot for a kind (0 = primary, 1 = secondary).
 * Hosts may still pin via createSimBackend({ workerSlot }).
 * @param {string} kind
 * @returns {0 | 1}
 */
export function preferredWorkerSlot(kind) {
  const k = String(kind || '');
  // Secondary worker: continuous particle fields that co-exist with physics.
  if (
    k === SIM_KIND.CONVECTION
    || k === SIM_KIND.HALL_CARRIERS
    || k === SIM_KIND.IDEAL_GAS
  ) {
    return 1;
  }
  return 0;
}
