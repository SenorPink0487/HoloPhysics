/**
 * Unified pure-sim kind factory for ExperimentSimBackend.
 */

import { createThermoKind } from './thermo.js';
import { createElectroKind } from './electro.js';
import { createOpticsKind } from './optics.js';
import { SIM_KIND } from '../simTypes.js';

/**
 * @param {string} kind
 * @param {object} [options]
 */
export function createSimKind(kind, options = {}) {
  const id = String(kind || '');
  if (id.startsWith('thermo.')) return createThermoKind(id, options);
  if (id.startsWith('electro.')) return createElectroKind(id, options);
  if (id.startsWith('optics.')) return createOpticsKind(id, options);
  throw new Error(`createSimKind: unsupported kind ${kind}`);
}

export {
  createThermoKind,
  createCalorimetryMixKind,
  createHeatConductionKind,
  createIdealGasKind,
  createConvectionKind,
} from './thermo.js';

export {
  createElectroKind,
  createElectricFieldLinesKind,
  createGaussMetricsKind,
  createHallCarriersKind,
} from './electro.js';

export {
  createOpticsKind,
  createDiffractionFringeKind,
  createGeometricAnglesKind,
} from './optics.js';

export { SIM_KIND };
