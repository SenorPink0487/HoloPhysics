/**
 * ExperimentSimBackend factory (Phase 2–3).
 *
 * Modes: main | worker | auto (default auto).
 * Kinds: thermo.* | electro.* | optics.*
 *
 * Contract:
 *   command(op, payload)
 *   step(dt) → snapshot { simTime, generation, scalars, fields?, particles?, deferred? }
 *   stepAsync(dt)
 *   getSnapshot()
 *   reinit(kind, options?)
 *   dispose()
 */

import { createMainSimBackend } from './simBackend.main.js';
import { createWorkerSimBackend } from './simBackend.worker.js';
import {
  resolveSimMode,
  preferredWorkerSlot,
  SIM_KIND,
  PARTICLE_STRIDE_POS_VEL,
  PARTICLE_STRIDE_POS_VEL_TEMP,
  FIELD_LINE_HEADER,
} from './simTypes.js';

export {
  resolveSimMode,
  preferredWorkerSlot,
  SIM_KIND,
  PARTICLE_STRIDE_POS_VEL,
  PARTICLE_STRIDE_POS_VEL_TEMP,
  FIELD_LINE_HEADER,
} from './simTypes.js';

export { createMainSimBackend } from './simBackend.main.js';
export { createWorkerSimBackend } from './simBackend.worker.js';
export {
  createSimKind,
  createThermoKind,
  createCalorimetryMixKind,
  createHeatConductionKind,
  createIdealGasKind,
  createConvectionKind,
  createElectroKind,
  createElectricFieldLinesKind,
  createGaussMetricsKind,
  createHallCarriersKind,
  createOpticsKind,
  createDiffractionFringeKind,
  createGeometricAnglesKind,
} from './simKinds/index.js';
export {
  acquireSimWorker,
  releaseSimWorker,
  disposeSimWorkerPool,
  resolveSimWorkerPoolSize,
  simWorkerPoolStats,
} from './simWorkerPool.js';

/**
 * @param {{
 *   kind: string,
 *   mode?: 'main' | 'worker' | 'auto',
 *   options?: object,
 *   worker?: Worker,
 *   WorkerCtor?: typeof Worker,
 *   workerUrl?: URL | string,
 *   workerSlot?: number,
 *   usePool?: boolean,
 *   onFallback?: (error: Error) => void,
 * }} [config]
 */
export function createSimBackend(config = {}) {
  if (!config.kind && !config.options?.kind) {
    throw new TypeError('createSimBackend: kind is required');
  }
  const kind = config.kind || config.options.kind;
  const mode = resolveSimMode(config);
  const options = { ...(config.options || {}), ...config };
  delete options.mode;
  delete options.worker;
  delete options.WorkerCtor;
  delete options.workerUrl;
  delete options.workerSlot;
  delete options.usePool;
  delete options.onFallback;
  delete options.kind;

  const mainOpts = { kind, options: config.options || options };
  const slot = config.workerSlot != null
    ? (config.workerSlot | 0)
    : preferredWorkerSlot(kind);

  if (mode === 'main') {
    const backend = createMainSimBackend(mainOpts);
    backend.workerSlot = slot;
    return backend;
  }

  try {
    return createWorkerSimBackend({
      kind,
      options: config.options || options,
      worker: config.worker,
      WorkerCtor: config.WorkerCtor,
      workerUrl: config.workerUrl,
      workerSlot: slot,
      usePool: config.usePool,
    });
  } catch (error) {
    if (mode === 'worker') {
      if (typeof console !== 'undefined') {
        console.warn('[SimBackend] worker mode failed — falling back to main', error);
      }
    } else if (typeof console !== 'undefined') {
      console.info('[SimBackend] auto mode: worker unavailable, using main', error?.message || error);
    }
    config.onFallback?.(error instanceof Error ? error : new Error(String(error)));
    const backend = createMainSimBackend(mainOpts);
    backend.workerSlot = slot;
    return backend;
  }
}
