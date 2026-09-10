import { findExperiment } from './catalog.js';

/**
 * Intent-gated module loaders.
 *
 * Catalog import must never trigger these dynamic imports. Station scene code
 * loads on station menu / stable prediction intent. Experiment handler code
 * loads only after a focused card, terminal activation, or explicit start.
 */

const stationLoaders = Object.freeze({
  mechanics: () => import('../scene/stations/mechanics.js'),
  thermo: () => import('../scene/stations/thermo.js'),
  optics: () => import('../scene/stations/optics.js'),
  electro: () => import('../scene/stations/electro.js'),
});

const experimentLoaders = Object.freeze({
  mechanics: () => Promise.resolve({
    station: { id: 'mechanics', title: '力学实验台', experiments: [] },
    createHandlers: () => ({}),
  }),
  thermo: () => Promise.resolve({
    station: { id: 'thermo', title: '热学实验台', experiments: [] },
    createHandlers: () => ({}),
  }),
  optics: () => Promise.resolve({
    station: { id: 'optics', title: '光学实验台', experiments: [] },
    createHandlers: () => ({}),
  }),
  electro: () => import('../experiments/electro.js'),
});

const stationRuntimeLoaders = Object.freeze({});

const cache = new Map();

function cached(key, loader) {
  if (!cache.has(key)) cache.set(key, loader());
  return cache.get(key);
}

/** Load only the station scene factory (geometry shell). */
export function loadStationModule(stationId) {
  const loader = stationLoaders[stationId];
  if (!loader) return Promise.reject(new Error(`Unknown station: ${stationId}`));
  return cached(`station:${stationId}`, loader);
}

/**
 * Load station experiment handlers. Call only after station or experiment
 * intent is confirmed — never from catalog import or cold boot.
 */
export function loadStationExperimentModule(stationId) {
  const loader = experimentLoaders[stationId];
  if (!loader) return Promise.reject(new Error(`Unknown station experiments: ${stationId}`));
  return cached(`experiment:${stationId}`, loader);
}

/**
 * Load experiment handlers for a specific experiment id.
 */
export function loadExperimentModule(expId, stationId = findExperiment(expId)?.stationId) {
  if (!stationId) {
    return Promise.reject(new Error(`Unknown experiment: ${expId}`));
  }
  return loadStationExperimentModule(stationId);
}

export async function loadStationBundle(stationId) {
  const [sceneModule, experimentModule] = await Promise.all([
    loadStationModule(stationId),
    loadStationExperimentModule(stationId),
  ]);
  return { sceneModule, experimentModule };
}

/** Station scene preload — intent / prediction only. */
export function preloadStation(stationId) {
  return loadStationModule(stationId);
}

/** Experiment handler preload — card focus / click only. */
export function preloadExperiment(expId, stationId) {
  return loadExperimentModule(expId, stationId);
}

/** Load only the source runtime needed by a selected experiment (Thermo). */
export function loadStationExperimentRuntime(stationId, expId) {
  const loader = stationRuntimeLoaders[stationId]?.[expId];
  if (!loader) return Promise.reject(new Error(`Unknown runtime: ${stationId}/${expId}`));
  return cached(`runtime:${stationId}:${expId}`, loader);
}

export function clearModulePromises() {
  cache.clear();
}

/** Test / debug: whether a module promise is already in flight or resolved. */
export function hasCachedModule(key) {
  return cache.has(key);
}

export function cachedModuleKeys() {
  return [...cache.keys()];
}
