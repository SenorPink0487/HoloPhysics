/**
 * PhysicsBackend factory.
 *
 * Modes:
 *   - 'main'   (default): cannon-es on the calling thread
 *   - 'worker': physics.worker.js + postMessage proxy (latest-complete-wins)
 *   - 'auto': try worker, fall back to main on construction failure
 *
 * Contract (stable across modes):
 *   addBody(desc) → bodyId
 *   removeBody(bodyId)
 *   getHandle(bodyId) → BodyHandle
 *   command(bodyId, op, payload)
 *   setGravity(x,y,z)
 *   step(dt, { onPreStep, forceStep }) → { simTime, steps, poses, skipped }
 *   syncMeshes(meshes)
 *   resetClock()
 *   dispose()
 */

import { createMainPhysicsBackend } from './physicsBackend.main.js';
import { createWorkerPhysicsBackend } from './physicsBackend.worker.js';

export {
  BODY_TYPE,
  DEFAULT_FIXED_DT,
  DEFAULT_MAX_SUBSTEPS,
  POSE_STRIDE,
  poseOffset,
  readPose,
  writePose,
} from './types.js';

export { createBodyHandle, createMainPhysicsBackend } from './physicsBackend.main.js';
export { createWorkerPhysicsBackend } from './physicsBackend.worker.js';
export {
  createSharedPoseBuffer,
  isSharedArrayBufferAvailable,
  publishSharedPoses,
  readSharedPoses,
  shouldUseSharedPoses,
  sharedPoseByteLength,
  SAB_I32,
  SAB_PROTOCOL_VERSION,
  SAB_HEADER_BYTES,
} from './sharedPoseBuffer.js';

/**
 * Resolve physics mode from options or global flag.
 * Host can set `globalThis.__PHYSICS_BACKEND_MODE__ = 'worker' | 'main' | 'auto'`.
 * @param {{ mode?: string }} options
 * @returns {'main' | 'worker' | 'auto'}
 */
export function resolvePhysicsMode(options = {}) {
  // Default auto: prefer physics worker (UI decoupled) with main fallback.
  // Hosts that need deterministic main-thread steps set mode:'main' or
  // globalThis.__PHYSICS_BACKEND_MODE__ = 'main'.
  const raw = options.mode
    ?? (typeof globalThis !== 'undefined' ? globalThis.__PHYSICS_BACKEND_MODE__ : null)
    ?? 'auto';
  if (raw === 'worker' || raw === 'auto' || raw === 'main') return raw;
  return 'auto';
}

/**
 * @param {{
 *   mode?: 'main' | 'worker' | 'auto',
 *   fixedDt?: number,
 *   maxSubSteps?: number,
 *   gravity?: [number, number, number],
 *   worker?: Worker,
 *   WorkerCtor?: typeof Worker,
 *   workerUrl?: URL | string,
 *   onFallback?: (error: Error) => void,
 * }} [options]
 */
export function createPhysicsBackend(options = {}) {
  const mode = resolvePhysicsMode(options);

  if (mode === 'main') {
    return createMainPhysicsBackend(options);
  }

  try {
    const backend = createWorkerPhysicsBackend(options);
    return backend;
  } catch (error) {
    if (mode === 'worker') {
      // Explicit worker request still falls back so labs keep running, but warn loudly.
      if (typeof console !== 'undefined') {
        console.warn('[PhysicsBackend] worker mode failed — falling back to main', error);
      }
    } else if (typeof console !== 'undefined') {
      console.info('[PhysicsBackend] auto mode: worker unavailable, using main', error?.message || error);
    }
    options.onFallback?.(error instanceof Error ? error : new Error(String(error)));
    return createMainPhysicsBackend(options);
  }
}
