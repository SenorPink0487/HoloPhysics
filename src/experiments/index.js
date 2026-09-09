/**
 * Experiments package entry.
 *
 * Layout:
 *   experiments/
 *     index.js       — public API
 *     registry.js    — station catalog
 *     manager.js     — orchestrator
 *     mechanics.js   — 力学
 *     optics.js      — 光学
 *     electro.js     — 电磁学
 *     thermo.js      — 热力学
 */
export { STATION_EXPERIMENTS, STATION_MODULES } from './registry.js';
export { createExperimentManager } from './manager.js';
export {
  EXPERIMENT_HANDLER_HOOKS,
  defineStationExperimentModule,
  createExperimentHandlers,
} from './contract.js';
