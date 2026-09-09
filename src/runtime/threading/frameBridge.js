/**
 * FrameBridge — coordinates PhysicsBackend + RenderBackend ticks (Phase 3/4).
 *
 * Main-thread labShell still owns the real room present. This bridge is the
 * contract for isolated worker pairs (physics worker ↔ render worker) and for
 * tests. latest-complete-wins: if physics or present is still in flight, the
 * bridge keeps the last good poses on screen.
 *
 * Pose forward uses POSE_STRIDE (physics) which matches RENDER_POSE_STRIDE.
 * Prefer createOffscreenIsland() for secondary-canvas demos — never #c.
 *
 * Usage:
 *   import { createFrameBridge } from './index.js';
 *   const bridge = createFrameBridge({ physics, render, meshIds: [ballId] });
 *   // each rAF:
 *   bridge.tick(dt);
 */

import { POSE_STRIDE } from './types.js';
import { RENDER_POSE_STRIDE } from './renderTypes.js';

/**
 * @param {object} [options]
 * @param {object} [options.physics]
 * @param {object} [options.render]
 * @param {Array<number|string>} [options.meshIds] bodyId order for pose → mesh
 * @param {Map|Record<string|number, number|string>} [options.bodyToMesh]
 * @param {Function} [options.onPreStep]
 * @param {Iterable<object>} [options.syncMainMeshes]
 */
export function createFrameBridge(options = {}) {
  const physics = options.physics || null;
  const render = options.render || null;
  let meshIds = options.meshIds ? [...options.meshIds] : [];
  const bodyToMesh = options.bodyToMesh || null;
  let onPreStep = options.onPreStep || null;
  let syncMainMeshes = options.syncMainMeshes || null;

  let lastSimTime = 0;
  let lastSteps = 0;
  let lastPresentMs = 0;
  let ticks = 0;
  let disposed = false;

  function resolveMeshId(bodyId) {
    if (!bodyToMesh) return bodyId;
    if (typeof bodyToMesh.get === 'function') return bodyToMesh.get(bodyId) ?? bodyId;
    return bodyToMesh[bodyId] ?? bodyId;
  }

  function collectPoses() {
    if (!physics || !meshIds.length || typeof physics.getPose !== 'function') {
      return null;
    }
    const stride = POSE_STRIDE || RENDER_POSE_STRIDE;
    const out = new Float32Array(meshIds.length * stride);
    const idOrder = [];
    let any = false;
    for (let i = 0; i < meshIds.length; i += 1) {
      const bodyId = meshIds[i];
      const pose = physics.getPose(bodyId);
      idOrder.push(resolveMeshId(bodyId));
      if (!pose) continue;
      any = true;
      const src = pose.length >= stride
        ? (typeof pose.subarray === 'function' ? pose.subarray(0, stride) : pose)
        : pose;
      out.set(src, i * stride);
    }
    if (!any) return null;
    return { buffer: out, idOrder, stride };
  }

  function forwardPoses() {
    if (!render || typeof render.applyPoses !== 'function') return false;
    const packed = collectPoses();
    if (!packed) return false;
    render.applyPoses(packed.buffer, { stride: packed.stride, idOrder: packed.idOrder });
    return true;
  }

  return {
    kind: 'frameBridge',

    get simTime() { return lastSimTime; },
    get lastSteps() { return lastSteps; },
    get lastPresentMs() { return lastPresentMs; },
    get ticks() { return ticks; },
    get meshIds() { return meshIds.slice(); },

    setMeshIds(ids = []) {
      meshIds = [...ids];
    },

    setOnPreStep(fn) {
      onPreStep = fn || null;
    },

    setSyncMainMeshes(meshes) {
      syncMainMeshes = meshes || null;
    },

    /**
     * One frame: physics.step → pose forward → render.present.
     * Non-blocking when backends are workers (returns deferred flags).
     * @param {number} dt
     * @param {{ forcePresent?: boolean, skipPhysics?: boolean, skipPresent?: boolean }} [opts]
     */
    tick(dt, opts = {}) {
      if (disposed) {
        return { simTime: lastSimTime, steps: 0, presented: false, deferred: true };
      }

      let physResult = { steps: 0, skipped: true, deferred: false, poses: null };
      if (!opts.skipPhysics && physics && typeof physics.step === 'function') {
        physResult = physics.step(dt, {
          onPreStep: onPreStep || undefined,
        }) || physResult;
        if (physResult.simTime != null) lastSimTime = physResult.simTime;
        lastSteps = physResult.steps || 0;

        // Main-thread mesh sync (lab SourceEngineAdapter path).
        if (syncMainMeshes && typeof physics.syncMeshes === 'function') {
          physics.syncMeshes(syncMainMeshes);
        }
        // Worker render path: push pose buffer.
        forwardPoses();
      }

      let presentResult = { presented: false, ms: lastPresentMs, deferred: false };
      if (!opts.skipPresent && render && typeof render.present === 'function') {
        presentResult = render.present() || presentResult;
        if (presentResult.ms != null) lastPresentMs = presentResult.ms;
      }

      ticks += 1;
      return {
        simTime: lastSimTime,
        steps: lastSteps,
        skipped: !!physResult.skipped,
        presented: !!presentResult.presented,
        deferred: !!(physResult.deferred || presentResult.deferred),
        presentMs: lastPresentMs,
        physicsKind: physics?.kind,
        renderKind: render?.kind,
      };
    },

    /** Await a full physics + present cycle (tests / explicit sync). */
    async tickAsync(dt, opts = {}) {
      if (disposed) return this.tick(dt, opts);
      if (!opts.skipPhysics && physics?.stepAsync) {
        const physResult = await physics.stepAsync(dt, {
          onPreStep: onPreStep || undefined,
        });
        if (physResult?.simTime != null) lastSimTime = physResult.simTime;
        lastSteps = physResult?.steps || 0;
        if (syncMainMeshes && typeof physics.syncMeshes === 'function') {
          physics.syncMeshes(syncMainMeshes);
        }
        forwardPoses();
      } else if (!opts.skipPhysics) {
        this.tick(dt, { ...opts, skipPresent: true });
      }

      let presentResult = { presented: false, ms: lastPresentMs };
      if (!opts.skipPresent && render?.presentAsync) {
        presentResult = await render.presentAsync();
      } else if (!opts.skipPresent && render?.present) {
        presentResult = render.present();
      }
      if (presentResult?.ms != null) lastPresentMs = presentResult.ms;
      ticks += 1;
      return {
        simTime: lastSimTime,
        steps: lastSteps,
        presented: !!presentResult?.presented,
        presentMs: lastPresentMs,
        deferred: false,
      };
    },

    dispose() {
      if (disposed) return false;
      disposed = true;
      meshIds = [];
      onPreStep = null;
      syncMainMeshes = null;
      return true;
    },
  };
}
