/**
 * RenderBackend factory.
 *
 * Modes:
 *   - 'main'   (default): present via existing Three WebGLRenderer on this thread
 *   - 'worker': OffscreenCanvas + render.worker.js (isolated primitive world)
 *   - 'auto': try worker, fall back to main on construction failure
 *
 * Contract:
 *   present() → { presented, ms, deferred? }
 *   presentAsync()
 *   resize(w, h, dpr?)
 *   upsertMesh / removeMesh / applyPoses / setCamera  (worker-oriented; main no-ops)
 *   whenReady()
 *   dispose()
 *
 * Important: the host lab scene graph stays on main. Worker mode is for
 * isolated canvases / progressive cutover — do not transfer the primary lab
 * canvas unless the scene has been migrated.
 */

import { createMainRenderBackend } from './renderBackend.main.js';
import { createWorkerRenderBackend } from './renderBackend.worker.js';
import { resolveRenderMode, canUseOffscreenCanvas } from './renderTypes.js';

export {
  RENDER_MESH_KIND,
  RENDER_POSE_STRIDE,
  resolveRenderMode,
  canUseOffscreenCanvas,
} from './renderTypes.js';

export { createMainRenderBackend } from './renderBackend.main.js';
export { createWorkerRenderBackend } from './renderBackend.worker.js';

/**
 * @param {{
 *   mode?: 'main' | 'worker' | 'auto',
 *   renderer?: object,
 *   scene?: object,
 *   camera?: object,
 *   canvas?: HTMLCanvasElement,
 *   offscreen?: OffscreenCanvas,
 *   worker?: Worker,
 *   WorkerCtor?: typeof Worker,
 *   workerUrl?: URL | string,
 *   width?: number,
 *   height?: number,
 *   pixelRatio?: number,
 *   onAfterPresent?: (ms: number) => void,
 *   onFallback?: (error: Error) => void,
 * }} [options]
 */
export function createRenderBackend(options = {}) {
  const mode = resolveRenderMode(options);

  if (mode === 'main') {
    return createMainRenderBackend(options);
  }

  try {
    if (mode === 'worker' || mode === 'auto') {
      if (!options.worker && !options.offscreen && !options.canvas) {
        throw new Error('worker render mode requires canvas, offscreen, or worker');
      }
      if (!options.worker && options.canvas && !canUseOffscreenCanvas()
        && typeof options.canvas.transferControlToOffscreen !== 'function') {
        throw new Error('OffscreenCanvas transfer is not available');
      }
      return createWorkerRenderBackend(options);
    }
  } catch (error) {
    if (mode === 'worker' && !options.renderer) {
      // Explicit worker without main renderer — rethrow so callers see the failure.
      if (typeof console !== 'undefined') {
        console.warn('[RenderBackend] worker mode failed', error);
      }
      throw error;
    }
    if (typeof console !== 'undefined') {
      console.warn('[RenderBackend] worker mode failed — falling back to main', error);
    }
    options.onFallback?.(error instanceof Error ? error : new Error(String(error)));
  }

  return createMainRenderBackend(options);
}
