/**
 * Main-thread ExperimentSimBackend — runs pure sim kinds on the calling thread.
 */

import { createSimKind } from './simKinds/index.js';
import { SIM_KIND } from './simTypes.js';

/**
 * @param {{
 *   kind: string,
 *   options?: object,
 * }} [config]
 */
export function createMainSimBackend(config = {}) {
  const kindId = config.kind || config.options?.kind;
  if (!kindId) throw new TypeError('createMainSimBackend: kind is required');

  let runner = createSimKind(kindId, config.options || config);
  let disposed = false;
  let lastSnapshot = runner.getSnapshot();
  let simTime = lastSnapshot.simTime || 0;

  return {
    kind: 'main',
    simKind: kindId,
    workerSlot: 0,

    get simTime() { return simTime; },
    get generation() { return lastSnapshot?.generation || 0; },
    get lastSnapshot() { return lastSnapshot; },

    command(op, payload) {
      if (disposed) return false;
      const ok = runner.command(op, payload);
      if (ok) lastSnapshot = runner.getSnapshot();
      return ok;
    },

    /**
     * @param {number} dt
     * @returns {object}
     */
    step(dt) {
      if (disposed) {
        return { ...lastSnapshot, skipped: true, deferred: false };
      }
      lastSnapshot = runner.step(dt);
      simTime = lastSnapshot.simTime || simTime;
      return { ...lastSnapshot, deferred: false, skipped: false };
    },

    async stepAsync(dt) {
      return this.step(dt);
    },

    getSnapshot() {
      return lastSnapshot || runner.getSnapshot();
    },

    /**
     * @param {string} nextKind
     * @param {object} [options]
     */
    reinit(nextKind, options = {}) {
      if (disposed) return false;
      runner.dispose?.();
      runner = createSimKind(nextKind || kindId, options);
      lastSnapshot = runner.getSnapshot();
      simTime = lastSnapshot.simTime || 0;
      return true;
    },

    dispose() {
      if (disposed) return false;
      disposed = true;
      runner.dispose?.();
      lastSnapshot = null;
      return true;
    },
  };
}

export { SIM_KIND };
