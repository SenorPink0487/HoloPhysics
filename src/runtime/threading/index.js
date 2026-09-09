/**
 * Threading runtime public surface (Physics / Render / FrameBridge).
 *
 * Prefer this barrel for new host code:
 *   import { createPhysicsBackend, createFrameBridge, … } from './runtime/threading/index.js';
 *
 * Architecture notes: ./ARCHITECTURE.md
 */

// ── Physics ──────────────────────────────────────────────────────────────
export {
  BODY_TYPE,
  DEFAULT_FIXED_DT,
  DEFAULT_MAX_SUBSTEPS,
  POSE_STRIDE,
  poseOffset,
  readPose,
  writePose,
  createPhysicsBackend,
  createMainPhysicsBackend,
  createWorkerPhysicsBackend,
  resolvePhysicsMode,
  createSharedPoseBuffer,
  isSharedArrayBufferAvailable,
  publishSharedPoses,
  readSharedPoses,
  shouldUseSharedPoses,
  sharedPoseByteLength,
  SAB_I32,
  SAB_PROTOCOL_VERSION,
  SAB_HEADER_BYTES,
} from './physicsBackend.js';

// ── Render ───────────────────────────────────────────────────────────────
export {
  RENDER_MESH_KIND,
  RENDER_POSE_STRIDE,
  resolveRenderMode,
  canUseOffscreenCanvas,
  createRenderBackend,
  createMainRenderBackend,
  createWorkerRenderBackend,
} from './renderBackend.js';

// ── Frame coordination ───────────────────────────────────────────────────
export { createFrameBridge } from './frameBridge.js';

// SimDriver lives next to frameCoordinator (not only threading), re-exported
// here so hosts can pull the full multi-thread surface from one barrel.
export { createSimDriver } from '../simDriver.js';

// ── Experiment SimBackend (thermo / electro / optics compute) ────────────
export {
  createSimBackend,
  createMainSimBackend,
  createWorkerSimBackend,
  createSimKind,
  createCalorimetryMixKind,
  createHeatConductionKind,
  createIdealGasKind,
  createConvectionKind,
  createThermoKind,
  createElectricFieldLinesKind,
  createGaussMetricsKind,
  createHallCarriersKind,
  createElectroKind,
  createDiffractionFringeKind,
  createGeometricAnglesKind,
  createOpticsKind,
  acquireSimWorker,
  releaseSimWorker,
  disposeSimWorkerPool,
  resolveSimWorkerPoolSize,
  simWorkerPoolStats,
  resolveSimMode,
  preferredWorkerSlot,
  SIM_KIND,
  PARTICLE_STRIDE_POS_VEL,
  PARTICLE_STRIDE_POS_VEL_TEMP,
  FIELD_LINE_HEADER,
} from './simBackend.js';

// ── Optional Offscreen island (never primary #c) ─────────────────────────
export {
  createOffscreenIsland,
  isPrimaryLabCanvas,
  PRIMARY_LAB_CANVAS_ID,
} from './offscreenIsland.js';
