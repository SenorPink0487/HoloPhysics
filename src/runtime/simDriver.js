/**
 * SimDriver — single fixed-step owner for experiment simulation.
 *
 * Live sim is re-homed out of `expManager.update` on the rAF path into
 * `FrameCoordinator.onFixedUpdate`, so Physics/Sim workers can run
 * latest-complete-wins without a second clock in animate().
 *
 * Contract:
 *   fixedUpdate(dt)  → integrate (handler update / simulate; backends may
 *                      be main or worker under the hood)
 *   visualUpdate(α)  → apply / interpolate only (optional)
 *   pause/resume     → soft-switch freezes sim without freezing present
 *
 * latest-complete-wins is enforced by the bound backends (PhysicsBackend /
 * ExperimentSimBackend). SimDriver itself never blocks on worker completion.
 */

/**
 * @param {{
 *   now?: () => number,
 *   onAfterFixed?: (result: object, dt: number) => void,
 * }} [options]
 */
export function createSimDriver(options = {}) {
  const now = options.now || (() => (
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  ));
  const onAfterFixed = options.onAfterFixed || null;

  /** @type {null | ((dt: number) => unknown)} */
  let simulate = null;
  /** @type {null | ((alpha: number) => unknown)} */
  let visual = null;
  /** @type {null | (() => boolean)} */
  let isActive = null;

  let paused = false;
  let enabled = true;
  let fixedTicks = 0;
  let visualTicks = 0;
  let lastFixedMs = 0;
  let lastResult = null;
  let lastError = null;

  return {
    kind: 'simDriver',

    get enabled() { return enabled; },
    get paused() { return paused; },
    get fixedTicks() { return fixedTicks; },
    get visualTicks() { return visualTicks; },
    get lastFixedMs() { return lastFixedMs; },
    get lastResult() { return lastResult; },
    get lastError() { return lastError; },

    /**
     * @param {{
     *   simulate?: (dt: number) => unknown,
     *   visual?: (alpha: number) => unknown,
     *   isActive?: () => boolean,
     * }} binding
     */
    bind(binding = {}) {
      simulate = typeof binding.simulate === 'function' ? binding.simulate : null;
      visual = typeof binding.visual === 'function' ? binding.visual : null;
      isActive = typeof binding.isActive === 'function' ? binding.isActive : null;
      return this;
    },

    setEnabled(value) {
      enabled = !!value;
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
    },

    /** Soft-switch / visibility helper. */
    setPaused(value) {
      paused = !!value;
    },

    /**
     * @returns {boolean} whether a simulate callback will run this tick
     */
    shouldSimulate() {
      if (!enabled || paused || !simulate) return false;
      if (isActive && !isActive()) return false;
      return true;
    },

    /**
     * Fixed-step integration entry used by FrameCoordinator.onFixedUpdate.
     * @param {number} dt
     */
    fixedUpdate(dt) {
      if (!this.shouldSimulate()) {
        return { skipped: true, reason: paused ? 'paused' : 'inactive' };
      }
      const t0 = now();
      try {
        lastResult = simulate(dt);
        lastError = null;
      } catch (error) {
        lastError = error;
        lastResult = { error };
        if (typeof console !== 'undefined') {
          console.warn('[SimDriver] fixedUpdate failed', error);
        }
      }
      lastFixedMs = now() - t0;
      fixedTicks += 1;
      const out = {
        skipped: false,
        ms: lastFixedMs,
        result: lastResult,
        ticks: fixedTicks,
      };
      onAfterFixed?.(out, dt);
      return out;
    },

    /**
     * Visual / apply entry used by FrameCoordinator.onVisualUpdate.
     * @param {number} alpha
     */
    visualUpdate(alpha) {
      if (!enabled || !visual) {
        return { skipped: true };
      }
      // Still apply while soft-paused? No — freeze the last applied pose.
      if (paused) return { skipped: true, reason: 'paused' };
      if (isActive && !isActive()) return { skipped: true, reason: 'inactive' };
      try {
        visual(alpha);
      } catch (error) {
        lastError = error;
        if (typeof console !== 'undefined') {
          console.warn('[SimDriver] visualUpdate failed', error);
        }
      }
      visualTicks += 1;
      return { skipped: false, ticks: visualTicks };
    },

    /** Test / diagnostics snapshot. */
    stats() {
      return {
        enabled,
        paused,
        fixedTicks,
        visualTicks,
        lastFixedMs,
        hasSimulate: !!simulate,
        hasVisual: !!visual,
        active: this.shouldSimulate(),
      };
    },

    dispose() {
      simulate = null;
      visual = null;
      isActive = null;
      lastResult = null;
      enabled = false;
    },
  };
}
