/**
 * Shared pose ring for Physics Worker ↔ Main (Phase 2).
 *
 * Requires cross-origin isolation (COOP + COEP) so SharedArrayBuffer is available.
 * Without SAB, the worker falls back to transferable Float32Array copies.
 *
 * Memory layout (little-endian):
 *   bytes 0..31  — Int32 control header (Atomics)
 *   bytes 32..   — Float32 payload: [simTime, pose0…, poseN]
 *
 * Pose stride matches types.POSE_STRIDE (10 floats per body slot).
 *
 * Writer protocol (worker):
 *   1. Atomics.store(GENERATION, odd)   // writing
 *   2. write floats + meta ints
 *   3. Atomics.store(GENERATION, even)  // complete (latest-complete-wins)
 *
 * Reader protocol (main):
 *   1. gen = Atomics.load(GENERATION); if gen is odd → previous frame still ok / skip
 *   2. read floats
 *   3. if Atomics.load(GENERATION) !== gen → torn; keep previous
 */

import { POSE_STRIDE } from './types.js';

export const SAB_HEADER_BYTES = 32;
export const SAB_HEADER_I32 = 8; // 32 / 4

/** Int32 indices into the control header. */
export const SAB_I32 = Object.freeze({
  /** Monotonic generation; odd = writing, even = complete. */
  GENERATION: 0,
  /** Allocated body slots in this SAB (buffer size). */
  CAPACITY_SLOTS: 1,
  /** Live body count reported by worker. */
  BODY_COUNT: 2,
  DYNAMIC_COUNT: 3,
  STEPS: 4,
  /** 1 if step was skipped (no dynamics). */
  SKIPPED: 5,
  /**
   * Number of pose slots written this frame (may exceed bodyCount when slots
   * are sparse / not compacted after removeBody).
   */
  POSE_SLOTS: 6,
  /** Protocol version. */
  VERSION: 7,
});

export const SAB_PROTOCOL_VERSION = 1;

/** Float32 index of simTime inside the payload region (after header). */
export const SAB_F32_SIM_TIME = 0;
/** First pose float index in the payload region. */
export const SAB_F32_POSES = 1;

/**
 * @returns {boolean}
 */
export function isSharedArrayBufferAvailable() {
  try {
    if (typeof SharedArrayBuffer === 'undefined') return false;
    // crossOriginIsolated is the authoritative browser signal; Node has no isolation.
    if (typeof globalThis !== 'undefined' && 'crossOriginIsolated' in globalThis) {
      return globalThis.crossOriginIsolated === true
        || (typeof Atomics !== 'undefined' && canAllocateSab());
    }
    return canAllocateSab();
  } catch {
    return false;
  }
}

function canAllocateSab() {
  try {
    // eslint-disable-next-line no-new
    new SharedArrayBuffer(8);
    return typeof Atomics !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Prefer SAB only when truly isolated OR explicitly forced (tests / Node).
 * @param {{ force?: boolean }} [opts]
 */
export function shouldUseSharedPoses(opts = {}) {
  if (opts.force === true) return canAllocateSab();
  if (typeof globalThis !== 'undefined' && globalThis.__PHYSICS_FORCE_SAB__ === true) {
    return canAllocateSab();
  }
  if (typeof globalThis !== 'undefined' && globalThis.crossOriginIsolated === true) {
    return canAllocateSab();
  }
  // Node unit tests: allow SAB when available and not in a browser document.
  if (typeof window === 'undefined' && canAllocateSab()) return true;
  return false;
}

/**
 * Byte size for a shared buffer holding `capacitySlots` body poses.
 * @param {number} capacitySlots
 */
export function sharedPoseByteLength(capacitySlots) {
  const slots = Math.max(1, capacitySlots | 0);
  const floatCount = SAB_F32_POSES + slots * POSE_STRIDE;
  return SAB_HEADER_BYTES + floatCount * 4;
}

/**
 * @param {number} [capacitySlots=8]
 * @returns {{
 *   sab: SharedArrayBuffer,
 *   i32: Int32Array,
 *   f32: Float32Array,
 *   capacitySlots: number,
 * }}
 */
export function createSharedPoseBuffer(capacitySlots = 8) {
  if (!canAllocateSab()) {
    throw new Error('SharedArrayBuffer is not available (need COOP/COEP cross-origin isolation)');
  }
  const capacity = Math.max(1, capacitySlots | 0);
  const sab = new SharedArrayBuffer(sharedPoseByteLength(capacity));
  const views = wrapSharedPoseBuffer(sab);
  Atomics.store(views.i32, SAB_I32.GENERATION, 0);
  Atomics.store(views.i32, SAB_I32.CAPACITY_SLOTS, capacity);
  Atomics.store(views.i32, SAB_I32.BODY_COUNT, 0);
  Atomics.store(views.i32, SAB_I32.DYNAMIC_COUNT, 0);
  Atomics.store(views.i32, SAB_I32.STEPS, 0);
  Atomics.store(views.i32, SAB_I32.SKIPPED, 0);
  Atomics.store(views.i32, SAB_I32.POSE_SLOTS, 0);
  Atomics.store(views.i32, SAB_I32.VERSION, SAB_PROTOCOL_VERSION);
  views.f32[SAB_F32_SIM_TIME] = 0;
  return { sab, ...views, capacitySlots: capacity };
}

/**
 * @param {SharedArrayBuffer} sab
 */
export function wrapSharedPoseBuffer(sab) {
  const i32 = new Int32Array(sab, 0, SAB_HEADER_I32);
  const f32 = new Float32Array(sab, SAB_HEADER_BYTES);
  return { i32, f32 };
}

/**
 * Grow if needed. Returns previous buffer if capacity is enough.
 * @param {{ sab: SharedArrayBuffer, capacitySlots: number } | null} current
 * @param {number} neededSlots
 */
export function ensureSharedPoseCapacity(current, neededSlots) {
  const need = Math.max(1, neededSlots | 0);
  if (current && current.capacitySlots >= need) return current;
  const nextCap = Math.max(need, current ? current.capacitySlots * 2 : 8);
  return createSharedPoseBuffer(nextCap);
}

/**
 * Worker: publish a complete pose frame into the shared buffer.
 * @param {{ i32: Int32Array, f32: Float32Array, capacitySlots: number }} views
 * @param {{
 *   simTime: number,
 *   steps: number,
 *   skipped: boolean,
 *   bodyCount: number,
 *   dynamicCount: number,
 *   poses: ArrayLike<number>,
 * }} frame
 */
export function publishSharedPoses(views, frame) {
  const { i32, f32, capacitySlots } = views;
  const poseFloats = Math.min(
    frame.poses?.length || 0,
    capacitySlots * POSE_STRIDE,
  );
  const poseSlots = Math.ceil(poseFloats / POSE_STRIDE);

  const gen = Atomics.load(i32, SAB_I32.GENERATION);
  // Move to odd (in-progress). If already odd, bump to next odd.
  const writing = gen % 2 === 0 ? gen + 1 : gen;
  Atomics.store(i32, SAB_I32.GENERATION, writing);

  f32[SAB_F32_SIM_TIME] = Number(frame.simTime) || 0;
  for (let i = 0; i < poseFloats; i += 1) {
    f32[SAB_F32_POSES + i] = frame.poses[i];
  }

  Atomics.store(i32, SAB_I32.BODY_COUNT, frame.bodyCount | 0);
  Atomics.store(i32, SAB_I32.DYNAMIC_COUNT, frame.dynamicCount | 0);
  Atomics.store(i32, SAB_I32.STEPS, frame.steps | 0);
  Atomics.store(i32, SAB_I32.SKIPPED, frame.skipped ? 1 : 0);
  Atomics.store(i32, SAB_I32.POSE_SLOTS, poseSlots);
  Atomics.store(i32, SAB_I32.CAPACITY_SLOTS, capacitySlots);

  // Complete → even generation.
  Atomics.store(i32, SAB_I32.GENERATION, writing + 1);
  return writing + 1;
}

/**
 * Main: try to snapshot a consistent frame from SAB.
 * @param {{ i32: Int32Array, f32: Float32Array }} views
 * @param {Float32Array} [outPoses] optional destination for pose copy
 * @returns {{
 *   ok: boolean,
 *   generation: number,
 *   simTime: number,
 *   steps: number,
 *   skipped: boolean,
 *   bodyCount: number,
 *   dynamicCount: number,
 *   poses: Float32Array,
 * } | null}
 */
export function readSharedPoses(views, outPoses) {
  const { i32, f32 } = views;
  const gen1 = Atomics.load(i32, SAB_I32.GENERATION);
  if (gen1 % 2 !== 0) {
    // Writer in progress — caller should keep previous poses.
    return null;
  }

  const bodyCount = Atomics.load(i32, SAB_I32.BODY_COUNT);
  const capacity = Atomics.load(i32, SAB_I32.CAPACITY_SLOTS);
  const poseSlots = Math.min(
    Atomics.load(i32, SAB_I32.POSE_SLOTS) || bodyCount,
    capacity,
  );
  const dynamicCount = Atomics.load(i32, SAB_I32.DYNAMIC_COUNT);
  const steps = Atomics.load(i32, SAB_I32.STEPS);
  const skipped = Atomics.load(i32, SAB_I32.SKIPPED) === 1;
  const simTime = f32[SAB_F32_SIM_TIME];
  const poseLen = poseSlots * POSE_STRIDE;

  let poses;
  if (outPoses && outPoses.length >= poseLen) {
    for (let i = 0; i < poseLen; i += 1) outPoses[i] = f32[SAB_F32_POSES + i];
    poses = outPoses.length === poseLen ? outPoses : outPoses.subarray(0, poseLen);
  } else {
    poses = new Float32Array(poseLen);
    for (let i = 0; i < poseLen; i += 1) poses[i] = f32[SAB_F32_POSES + i];
  }

  const gen2 = Atomics.load(i32, SAB_I32.GENERATION);
  if (gen2 !== gen1) return null; // torn read

  return {
    ok: true,
    generation: gen1,
    simTime,
    steps,
    skipped,
    bodyCount,
    dynamicCount,
    poseSlots,
    poses,
  };
}

/**
 * Zero-copy view of pose floats in SAB (only safe when generation is stable).
 * Prefer readSharedPoses for a consistent snapshot.
 */
export function sharedPoseView(views) {
  const capacity = Atomics.load(views.i32, SAB_I32.CAPACITY_SLOTS);
  const bodyCount = Math.min(
    Atomics.load(views.i32, SAB_I32.BODY_COUNT),
    capacity,
  );
  return views.f32.subarray(SAB_F32_POSES, SAB_F32_POSES + bodyCount * POSE_STRIDE);
}
