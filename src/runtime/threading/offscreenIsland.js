/**
 * Optional isolated OffscreenCanvas island (Phase 4 demo helper).
 *
 * Builds a PhysicsBackend + RenderBackend + FrameBridge triple for a
 * *secondary* canvas. Never transfers the primary lab canvas (`#c`).
 *
 * Usage (browser):
 *   const island = await createOffscreenIsland({
 *     canvas: document.getElementById('physics-preview'),
 *     physicsMode: 'auto',
 *     renderMode: 'auto',   // worker when Offscreen available, else main stub
 *   });
 *   const ballId = island.physics.addBody({ shape: 'sphere', … });
 *   island.setMeshIds([ballId]);
 *   // rAF:
 *   island.tick(dt);
 *   island.dispose();
 *
 * In Node / tests, pass mock `worker` / `offscreen` / main-only backends.
 */

import { createPhysicsBackend } from './physicsBackend.js';
import { createRenderBackend } from './renderBackend.js';
import { createFrameBridge } from './frameBridge.js';
import { canUseOffscreenCanvas } from './renderTypes.js';
import { BODY_TYPE, POSE_STRIDE } from './types.js';
import { RENDER_MESH_KIND, RENDER_POSE_STRIDE } from './renderTypes.js';

/** Document id of the room WebGL canvas — must never be transferred. */
export const PRIMARY_LAB_CANVAS_ID = 'c';

/**
 * @param {HTMLCanvasElement | null | undefined} canvas
 * @returns {boolean}
 */
export function isPrimaryLabCanvas(canvas) {
  if (!canvas) return false;
  const id = canvas.id || canvas.getAttribute?.('id') || '';
  if (id === PRIMARY_LAB_CANVAS_ID) return true;
  // data-lab-primary="true" escape hatch for hosts that rename #c
  if (canvas.dataset?.labPrimary === 'true') return true;
  if (canvas.getAttribute?.('data-lab-primary') === 'true') return true;
  return false;
}

/**
 * Resolve island render mode without claiming the primary canvas.
 * @param {object} options
 * @returns {'main' | 'worker' | 'auto'}
 */
function resolveIslandRenderMode(options = {}) {
  if (options.renderMode === 'main' || options.renderMode === 'worker' || options.renderMode === 'auto') {
    return options.renderMode;
  }
  if (options.mode === 'main' || options.mode === 'worker' || options.mode === 'auto') {
    return options.mode;
  }
  // Prefer worker when an Offscreen path is supplied; otherwise main no-op present.
  if (options.worker || options.offscreen) return 'worker';
  if (options.canvas && canUseOffscreenCanvas()) return 'auto';
  return 'main';
}

/**
 * Minimal main render stand-in when the island has no Three host renderer.
 * Counts presents so FrameBridge / tests still see presented:true.
 */
function createIslandStubRenderer() {
  let presents = 0;
  return {
    kind: 'islandStub',
    presentCount: () => presents,
    render() { presents += 1; },
    setSize() {},
    setPixelRatio() {},
    dispose() {},
  };
}

/**
 * @param {{
 *   canvas?: HTMLCanvasElement,
 *   offscreen?: OffscreenCanvas,
 *   physicsMode?: 'main' | 'worker' | 'auto',
 *   renderMode?: 'main' | 'worker' | 'auto',
 *   physics?: object,
 *   render?: object,
 *   worker?: Worker,
 *   physicsWorker?: Worker,
 *   renderWorker?: Worker,
 *   WorkerCtor?: typeof Worker,
 *   meshIds?: Array<number|string>,
 *   width?: number,
 *   height?: number,
 *   pixelRatio?: number,
 *   gravity?: [number, number, number],
 *   allowPrimaryCanvas?: boolean,
 *   onFallback?: (error: Error, which: 'physics' | 'render') => void,
 *   renderer?: object,
 *   scene?: object,
 *   camera?: object,
 * }} [options]
 */
export function createOffscreenIsland(options = {}) {
  const canvas = options.canvas || null;

  if (canvas && isPrimaryLabCanvas(canvas) && !options.allowPrimaryCanvas) {
    throw new Error(
      `createOffscreenIsland: refusing to transfer primary lab canvas #${PRIMARY_LAB_CANVAS_ID}. `
      + 'Pass a secondary preview canvas, or set allowPrimaryCanvas:true only for deliberate migrate experiments.',
    );
  }

  const physicsMode = options.physicsMode
    ?? (typeof globalThis !== 'undefined' ? globalThis.__PHYSICS_BACKEND_MODE__ : null)
    ?? 'auto';

  const renderMode = resolveIslandRenderMode(options);

  const physics = options.physics || createPhysicsBackend({
    mode: physicsMode,
    gravity: options.gravity || [0, -9.81, 0],
    worker: options.physicsWorker || options.worker,
    WorkerCtor: options.WorkerCtor,
    onFallback: options.onFallback
      ? (err) => options.onFallback(err, 'physics')
      : undefined,
  });

  let render = options.render || null;
  let ownedStubRenderer = null;

  if (!render) {
    const hasWorkerPath = !!(options.renderWorker || options.offscreen
      || (canvas && (renderMode === 'worker' || renderMode === 'auto')));

    if (hasWorkerPath && renderMode !== 'main') {
      try {
        render = createRenderBackend({
          mode: renderMode === 'auto' ? 'worker' : renderMode,
          canvas: options.offscreen ? undefined : canvas || undefined,
          offscreen: options.offscreen || undefined,
          worker: options.renderWorker,
          WorkerCtor: options.WorkerCtor,
          width: options.width,
          height: options.height,
          pixelRatio: options.pixelRatio,
          onFallback: options.onFallback
            ? (err) => options.onFallback(err, 'render')
            : undefined,
        });
      } catch (error) {
        if (renderMode === 'worker' && !options.renderer) {
          options.onFallback?.(error instanceof Error ? error : new Error(String(error)), 'render');
          // Fall through to stub so island still constructs for physics-only demos.
        } else {
          options.onFallback?.(error instanceof Error ? error : new Error(String(error)), 'render');
        }
        render = null;
      }
    }

    if (!render) {
      ownedStubRenderer = options.renderer || createIslandStubRenderer();
      render = createRenderBackend({
        mode: 'main',
        renderer: ownedStubRenderer,
        scene: options.scene || {},
        camera: options.camera || {},
      });
    }
  }

  const bridge = createFrameBridge({
    physics,
    render,
    meshIds: options.meshIds || [],
  });

  let disposed = false;

  return {
    kind: 'offscreenIsland',
    physics,
    render,
    bridge,
    canvas,
    /** True when render is a real worker Offscreen path. */
    get usesWorkerRender() {
      return render?.kind === 'worker';
    },
    get usesWorkerPhysics() {
      return physics?.kind === 'worker';
    },
    get meshIds() {
      return bridge.meshIds;
    },
    setMeshIds(ids) {
      bridge.setMeshIds(ids);
    },
    /**
     * Convenience: add a dynamic sphere and register its mesh id for pose forward.
     * @param {object} [desc]
     * @returns {number} bodyId
     */
    addDemoSphere(desc = {}) {
      const bodyId = physics.addBody({
        shape: 'sphere',
        radius: desc.radius ?? 0.25,
        position: desc.position || [0, 3, 0],
        mass: desc.mass ?? 1,
        type: desc.type ?? BODY_TYPE.DYNAMIC,
        ...desc,
      });
      if (render?.kind === 'worker' && typeof render.upsertMesh === 'function') {
        render.upsertMesh({
          id: bodyId,
          kind: RENDER_MESH_KIND.SPHERE,
          radius: desc.radius ?? 0.25,
          position: desc.position || [0, 3, 0],
        });
      }
      const ids = bridge.meshIds;
      if (!ids.includes(bodyId)) {
        bridge.setMeshIds([...ids, bodyId]);
      }
      return bodyId;
    },
    tick(dt, opts) {
      if (disposed) return { disposed: true };
      return bridge.tick(dt, opts);
    },
    async tickAsync(dt, opts) {
      if (disposed) return { disposed: true };
      return bridge.tickAsync(dt, opts);
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      bridge.dispose();
      physics?.dispose?.();
      render?.dispose?.();
      ownedStubRenderer = null;
      return true;
    },
  };
}

export { BODY_TYPE, POSE_STRIDE, RENDER_MESH_KIND, RENDER_POSE_STRIDE };
