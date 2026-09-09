/**
 * Shared constants for RenderBackend (main + OffscreenCanvas worker).
 *
 * Full lab scene graph stays on the main thread by default — moving every
 * station mesh into a worker is a multi-phase migration. The worker path owns
 * an isolated Three.js world (primitives + camera) suitable for:
 *   - physics pose visualization
 *   - future island / preview canvases
 *   - progressive OffscreenCanvas cutover
 */

/** Matches physics pose stride so FrameBridge can forward buffers directly. */
export const RENDER_POSE_STRIDE = 10;

export const RENDER_MESH_KIND = Object.freeze({
  SPHERE: 'sphere',
  BOX: 'box',
  PLANE: 'plane',
  GROUP: 'group',
});

/**
 * Resolve render mode from options or global flag.
 * Host can set `globalThis.__RENDER_BACKEND_MODE__ = 'worker' | 'main' | 'auto'`.
 * @param {{ mode?: string }} [options]
 * @returns {'main' | 'worker' | 'auto'}
 */
export function resolveRenderMode(options = {}) {
  const raw = options.mode
    ?? (typeof globalThis !== 'undefined' ? globalThis.__RENDER_BACKEND_MODE__ : null)
    ?? 'main';
  if (raw === 'worker' || raw === 'auto' || raw === 'main') return raw;
  return 'main';
}

/**
 * @returns {boolean}
 */
export function canUseOffscreenCanvas() {
  try {
    return typeof OffscreenCanvas !== 'undefined'
      && typeof HTMLCanvasElement !== 'undefined'
      && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
  } catch {
    return false;
  }
}
