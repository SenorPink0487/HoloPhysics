/**
 * Frame-budget job queue — camera smoothness over immediacy.
 *
 * Policy:
 *  - Locomotion + WebGL present must never wait on heavy work.
 *  - At most one job per drain pulse.
 *  - Jobs longer than `heavyMs` force camera-only cooldown frames.
 *  - `scheduleCoop` splits long work into time slices with rest between.
 *  - `softSwitch` lets the render loop skip animators / raycasts while
 *    an experiment switch is still draining, so look/WASD stay live.
 */

/**
 * @param {{
 *   budgetMs?: number,
 *   maxJobsPerPulse?: number,
 *   heavyMs?: number,
 *   cooldownFrames?: number,
 *   chainRestFrames?: number,
 *   coopSliceMs?: number,
 *   onJobTimed?: (id: string, dtMs: number) => void,
 * }} [opts]
 */
export function createFrameScheduler(opts = {}) {
  const defaultBudgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : 2.5;
  const maxJobsPerPulse = Number.isFinite(opts.maxJobsPerPulse) ? opts.maxJobsPerPulse : 1;
  const heavyMs = Number.isFinite(opts.heavyMs) ? opts.heavyMs : 4.0;
  const cooldownAfterHeavy = Number.isFinite(opts.cooldownFrames) ? opts.cooldownFrames : 2;
  const defaultChainRest = Number.isFinite(opts.chainRestFrames) ? opts.chainRestFrames : 1;
  const defaultCoopSliceMs = Number.isFinite(opts.coopSliceMs) ? opts.coopSliceMs : 3.0;
  /** @type {null | ((id: string, dtMs: number) => void)} */
  let onJobTimed = typeof opts.onJobTimed === 'function' ? opts.onJobTimed : null;

  /** @type {Array<{ id: string, fn: () => void, priority: number, gen: number, soft: boolean }>} */
  const queue = [];
  /** Cancel tokens: id → generation that is still valid */
  const generations = new Map();
  let scheduled = false;
  /** Frames to skip drain after a heavy job (camera-only frames). */
  let cooldown = 0;
  /** Extra frames where the app should skip animators / focus raycasts. */
  let softFrames = 0;
  /**
   * Work-based switch session. Unlike softFrames (countdown), this stays active
   * until the job queue has been idle for a few frames — so a 2s open path
   * cannot "escape" soft mode after an arbitrary 36-frame timer.
   */
  let switchSession = false;
  let switchIdleFrames = 0;
  let lastJobMs = 0;

  /**
   * Job ids that keep an experiment-switch session alive.
   * Intentionally excludes `hud:*` — content paints may re-queue while waiting
   * for soft frames; counting them as switch work deadlocks the session.
   */
  function isSwitchRelatedJobId(id) {
    const s = String(id || '');
    if (s.startsWith('hud:')) return false;
    return /^(exp:|electro:|mech:|thermo:|optics:)/.test(s)
      || s.includes(':freeze')
      || s.includes(':unfreeze')
      || s.includes(':raycast')
      || s.includes(':sync')
      || s.includes(':reset')
      || s.includes(':open-');
  }

  function hasSwitchWork() {
    // Cooldown alone must NOT count — rest() after a heavy job would otherwise
    // pin switchSession forever (soft-switch skips interaction → "关闭后还卡").
    for (let i = 0; i < queue.length; i += 1) {
      if (isSwitchRelatedJobId(queue[i].id)) return true;
    }
    return false;
  }

  function nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function sortQueue() {
    queue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Force N upcoming drain pulses to no-op (camera keeps the main thread).
   * @param {number} frames
   */
  function rest(frames = 1) {
    const n = Math.max(0, Math.floor(Number(frames) || 0));
    if (n > cooldown) cooldown = n;
  }

  /**
   * Mark the next N animation frames as "soft switch": render loop should only
   * do camera + present + a tiny budget drain (no station animators / focus).
   * @param {number} frames
   */
  function beginSoftSwitch(frames = 16) {
    const n = Math.max(0, Math.floor(Number(frames) || 0));
    if (n > softFrames) softFrames = n;
  }

  /** End soft-switch immediately (call when closing menus / fullscreen). */
  function endSoftSwitch() {
    softFrames = 0;
    switchSession = false;
    switchIdleFrames = 0;
  }

  /**
   * Begin a work-based experiment-switch session.
   * Soft mode lasts until switch-related jobs drain (+ a few idle frames),
   * not merely N countdown frames.
   */
  function beginSwitchSession() {
    switchSession = true;
    switchIdleFrames = 0;
    // Minimum camera-only runway even if the first job is tiny.
    beginSoftSwitch(12);
  }

  /**
   * Soft-switch = countdown frames OR an open switch session that still has
   * (or just had) switch work. Cooldown alone does not count — that was the
   * old "rest() forever" trap with HUD waiters.
   */
  function softSwitchActive() {
    return softFrames > 0 || switchSession;
  }

  /** Call once per animation frame from the main loop. */
  function tickSoftSwitch() {
    if (softFrames > 0) softFrames -= 1;
    if (!switchSession) return;
    if (hasSwitchWork()) {
      switchIdleFrames = 0;
      // Keep a small countdown so a one-frame empty queue gap does not thrash.
      if (softFrames < 2) softFrames = 2;
      return;
    }
    switchIdleFrames += 1;
    // 4 idle frames (~60ms) with no switch jobs → session complete.
    if (switchIdleFrames >= 4) {
      switchSession = false;
      switchIdleFrames = 0;
    }
  }

  /**
   * Enqueue work. Same `id` replaces any pending job (latest wins).
   * @param {string} id
   * @param {() => void} fn
   * @param {{ priority?: number, soft?: boolean }} [jobOpts]
   *   soft:false → a heavy run will NOT rest / soft-switch (open path).
   */
  function schedule(id, fn, jobOpts = {}) {
    if (typeof fn !== 'function') return;
    const key = String(id || 'job');
    const gen = (generations.get(key) || 0) + 1;
    generations.set(key, gen);
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].id === key) queue.splice(i, 1);
    }
    queue.push({
      id: key,
      fn,
      priority: Number(jobOpts.priority) || 0,
      gen,
      // Default soft:true preserves camera-first for background work.
      soft: jobOpts.soft !== false,
    });
    sortQueue();
    arm();
  }

  /**
   * Cooperative job: `stepFn` returns true while more work remains.
   * Runs at most `sliceMs` per pulse, then rests a frame for the camera.
   *
   * @param {string} id
   * @param {() => boolean} stepFn
   * @param {{ priority?: number, sliceMs?: number, restFrames?: number, soft?: boolean, maxPulses?: number }} [jobOpts]
   *   soft:false → never enter soft-switch (background matrix walks during open)
   */
  function scheduleCoop(id, stepFn, jobOpts = {}) {
    if (typeof stepFn !== 'function') return;
    const key = String(id || 'coop');
    const priority = Number(jobOpts.priority) || 0;
    const sliceMs = Number.isFinite(jobOpts.sliceMs) ? jobOpts.sliceMs : defaultCoopSliceMs;
    const gap = Number.isFinite(jobOpts.restFrames)
      ? Math.max(0, Math.floor(jobOpts.restFrames))
      : 1;
    // Hard cap so a stuck stepFn cannot keep the lab in soft-switch forever.
    const maxPulses = Number.isFinite(jobOpts.maxPulses) ? Math.max(1, jobOpts.maxPulses) : 48;
    // Default soft:true preserves historical behaviour; open-path freezes pass soft:false.
    const wantSoft = jobOpts.soft !== false;
    let pulses = 0;

    if (wantSoft) beginSoftSwitch(8);

    function run() {
      const t0 = nowMs();
      let more = true;
      try {
        // Always do at least one step so progress cannot stall on a 0-budget frame.
        more = !!stepFn();
        while (more && (nowMs() - t0) < sliceMs) {
          more = !!stepFn();
        }
      } catch {
        more = false;
      }
      pulses += 1;
      if (more && pulses < maxPulses) {
        if (wantSoft) beginSoftSwitch(4);
        if (gap > 0) rest(gap);
        schedule(key, run, { priority, soft: wantSoft });
      }
    }

    schedule(key, run, { priority, soft: wantSoft });
  }

  /**
   * Run `steps` one per drain pulse, with mandatory rest frames between them.
   * @param {string} baseId
   * @param {Array<() => void>} steps
   * @param {{ priority?: number, restFrames?: number }} [jobOpts]
   */
  function scheduleChain(baseId, steps, jobOpts = {}) {
    const list = Array.isArray(steps) ? steps.filter((fn) => typeof fn === 'function') : [];
    if (!list.length) return;
    const key = String(baseId || 'chain');
    const priority = Number(jobOpts.priority) || 0;
    const gap = Number.isFinite(jobOpts.restFrames)
      ? Math.max(0, Math.floor(jobOpts.restFrames))
      : defaultChainRest;
    // soft:false → never soft-switch (open/close must not pin camera-only mode).
    // soft:true → always soft. omitted → soft only when restFrames > 0 (legacy).
    const wantSoft = jobOpts.soft === true
      ? true
      : jobOpts.soft === false
        ? false
        : gap > 0;

    const gen = (generations.get(key) || 0) + 1;
    generations.set(key, gen);
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].id === key || queue[i].id.startsWith(`${key}#`)) {
        queue.splice(i, 1);
      }
    }

    if (wantSoft) {
      beginSoftSwitch(list.length * (1 + gap) + 10);
    }

    let index = 0;
    const stepId = `${key}#step`;

    function pump() {
      if (generations.get(key) !== gen) return;
      if (index >= list.length) return;
      const fn = list[index];
      index += 1;
      try {
        fn();
      } catch {
        /* never break the frame over a chain step */
      }
      if (index < list.length && generations.get(key) === gen) {
        if (gap > 0) rest(gap);
        // Keep soft-switch only when the chain requested it (wantSoft).
        // Never reference removed forceSoft/useSoft names — that threw after
        // step 0 and aborted applyVisualDefaults (apparatus stayed hidden).
        if (wantSoft) beginSoftSwitch(6);
        schedule(stepId, pump, { priority, soft: wantSoft });
      }
    }

    schedule(stepId, pump, { priority, soft: wantSoft });
  }

  /** Cancel a pending id (and invalidate in-flight gen). */
  function cancel(id) {
    const key = String(id || '');
    generations.set(key, (generations.get(key) || 0) + 1);
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].id === key || queue[i].id.startsWith(`${key}#`)) {
        queue.splice(i, 1);
      }
    }
  }

  /** Cancel every queued job whose id begins with `prefix`. */
  function cancelPrefix(prefix) {
    const key = String(prefix || '');
    if (!key) return;
    const ids = new Set();
    for (const job of queue) {
      if (job.id.startsWith(key)) ids.add(job.id);
    }
    for (const id of ids) cancel(id);
  }

  function arm() {
    scheduled = queue.length > 0 || cooldown > 0 || softFrames > 0 || switchSession;
  }

  /**
   * Run queued jobs until budget exhausted. Call only AFTER renderer.render().
   * @param {number} [budgetMs]
   * @returns {number} jobs run
   */
  function drain(budgetMs = defaultBudgetMs) {
    if (cooldown > 0) {
      cooldown -= 1;
      scheduled = queue.length > 0 || cooldown > 0 || softFrames > 0 || switchSession;
      return 0;
    }
    if (!queue.length) {
      scheduled = softFrames > 0 || switchSession;
      return 0;
    }
    const start = nowMs();
    const limit = Math.max(0.5, Number(budgetMs) || defaultBudgetMs);
    let ran = 0;
    while (queue.length && ran < maxJobsPerPulse) {
      const tNow = nowMs();
      if (tNow - start >= limit) break;
      const job = queue.shift();
      if (!job) break;
      if (generations.get(job.id) !== job.gen) continue;

      try {
        runGuarded(job.fn, job.id);
      } catch {
        /* never let a deferred job kill the frame */
      }
      ran += 1;

      // Open-path jobs pass soft:false — never pin camera-only mode or rest
      // cooldowns that stall the exp:switch chain for multiple frames.
      if (lastJobMs >= heavyMs && job.soft !== false) {
        rest(cooldownAfterHeavy);
        beginSoftSwitch(cooldownAfterHeavy + 2);
        // Long jobs during an explicit soft switch session: keep it alive.
        if (switchSession || isSwitchRelatedJobId(job.id)) {
          switchSession = true;
          switchIdleFrames = 0;
        }
      }
      if (maxJobsPerPulse <= 1) break;
    }
    scheduled = queue.length > 0 || cooldown > 0 || softFrames > 0 || switchSession;
    return ran;
  }

  function pending() {
    return queue.length;
  }

  function clear() {
    queue.length = 0;
    generations.clear();
    cooldown = 0;
    softFrames = 0;
    switchSession = false;
    switchIdleFrames = 0;
  }

  /**
   * Instrument a job: if it exceeds `warnMs`, the main thread was blocked and
   * soft-switch cannot save the frame. Call sites should split such work.
   */
  function runGuarded(fn, id) {
    const t0 = nowMs();
    try {
      fn();
    } finally {
      lastJobMs = nowMs() - t0;
      try { onJobTimed?.(String(id || 'job'), lastJobMs); } catch { /* ignore */ }
      if (lastJobMs >= 16 && typeof console !== 'undefined' && console.warn) {
        console.warn(
          `[frameBudget] job "${id}" blocked main thread for ${lastJobMs.toFixed(1)}ms — split or soft-reset`,
        );
      }
      if (lastJobMs >= 50 && typeof console !== 'undefined' && console.log) {
        console.log(`[open-trace] HEAVY job id=${id} dt=${lastJobMs.toFixed(1)}ms`);
      }
    }
  }

  return {
    schedule,
    scheduleChain,
    scheduleCoop,
    cancel,
    cancelPrefix,
    rest,
    beginSoftSwitch,
    beginSwitchSession,
    endSoftSwitch,
    softSwitchActive,
    tickSoftSwitch,
    drain,
    pending,
    clear,
    lastJobMs: () => lastJobMs,
    cooldown: () => cooldown,
    softFrames: () => softFrames,
    switchSession: () => switchSession,
    /**
     * Optional sink for open-timing instrumentation (set once from main).
     * @param {null | ((id: string, dtMs: number) => void)} fn
     */
    setJobTimedListener(fn) {
      onJobTimed = typeof fn === 'function' ? fn : null;
    },
    /** @internal test/debug */
    _queue: queue,
  };
}

/** Shared singleton for the lab shell (imported by manager + main). */
export const labFrameScheduler = createFrameScheduler({
  // Hard 2 ms background budget — render owns the rest of the frame.
  budgetMs: 2.0,
  maxJobsPerPulse: 1,
  // ~1/4 frame: anything longer forces camera-only follow-up frames.
  heavyMs: 4.0,
  cooldownFrames: 2,
  chainRestFrames: 1,
  coopSliceMs: 2.0,
});

/**
 * Apply matrixAutoUpdate freeze/unfreeze for a single object3D node.
 * @param {{ matrixAutoUpdate?: boolean, updateMatrix?: () => void, children?: any[] }} object
 * @param {boolean} frozen
 */
export function applyMatrixFreezeFlag(object, frozen) {
  if (!object) return;
  object.matrixAutoUpdate = !frozen;
  if (frozen) object.updateMatrix?.();
}

/**
 * Synchronous full-tree freeze (boot / tests only). Prefer scheduleChunkedMatrixFreeze
 * on the interaction path — a dense apparatus walk is a multi-frame hitch.
 * Uses a stack walk (does not require THREE.Object3D.traverse).
 * @param {{ children?: any[] } | null} root
 * @param {boolean} frozen
 */
export function freezeMatrixTreeSync(root, frozen) {
  if (!root) return;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const object = stack.pop();
    if (!object) continue;
    n += 1;
    applyMatrixFreezeFlag(object, frozen);
    const kids = object.children;
    if (kids && kids.length) {
      for (let i = 0; i < kids.length; i += 1) stack.push(kids[i]);
    }
  }
  if (typeof performance !== 'undefined' && typeof console !== 'undefined') {
    const dt = performance.now() - t0;
    if (dt >= 8) {
      console.log(`[open-trace] freezeMatrixTreeSync frozen=${!!frozen} nodes=${n} dt=${dt.toFixed(1)}ms`);
    }
  }
}

/**
 * Time-slice freeze/unfreeze of a dense Object3D tree so experiment first-open
 * never walks thousands of nodes in one rAF (the classic "open freezes a bit").
 *
 * Uses a stack walk (no pre-collect list) and cooperates with the frame budget.
 *
 * @param {string} id unique job id (same id cancels prior walk)
 * @param {{ children?: any[] } | null} root
 * @param {boolean} frozen true → freeze (matrixAutoUpdate false + bake matrix)
 * @param {{
 *   scheduler?: ReturnType<typeof createFrameScheduler>,
 *   priority?: number,
 *   batch?: number,
 *   sliceMs?: number,
 *   restFrames?: number,
 *   maxPulses?: number,
 *   isStale?: () => boolean,
 *   onDone?: () => void,
 *   sync?: boolean,
 *   soft?: boolean,
 * }} [opts]
 *   soft:false → matrix walk never pins camera-only soft-switch (first-open path)
 */
export function scheduleChunkedMatrixFreeze(id, root, frozen, opts = {}) {
  const scheduler = opts.scheduler || labFrameScheduler;
  const wantFrozen = !!frozen;
  const onDone = typeof opts.onDone === 'function' ? opts.onDone : null;
  const isStale = typeof opts.isStale === 'function' ? opts.isStale : null;
  // Presence / open-path freezes should not freeze interaction for ~1s.
  const wantSoft = opts.soft !== false;

  if (!root) {
    onDone?.();
    return;
  }

  // Boot / explicit sync path (or missing coop) — finish immediately.
  if (opts.sync || typeof scheduler?.scheduleCoop !== 'function') {
    freezeMatrixTreeSync(root, wantFrozen);
    onDone?.();
    return;
  }

  const batch = Math.max(16, Math.floor(Number(opts.batch) || 72));
  const stack = [root];

  if (wantSoft) scheduler.beginSoftSwitch?.(6);
  scheduler.scheduleCoop(String(id || 'matrix-freeze'), () => {
    if (isStale?.()) return false;
    let n = 0;
    while (stack.length && n < batch) {
      const object = stack.pop();
      if (!object) continue;
      applyMatrixFreezeFlag(object, wantFrozen);
      const kids = object.children;
      if (kids && kids.length) {
        for (let i = 0; i < kids.length; i += 1) stack.push(kids[i]);
      }
      n += 1;
    }
    if (stack.length) return true;
    onDone?.();
    return false;
  }, {
    priority: Number.isFinite(opts.priority) ? opts.priority : 35,
    sliceMs: Number.isFinite(opts.sliceMs) ? opts.sliceMs : 2.5,
    restFrames: Number.isFinite(opts.restFrames) ? opts.restFrames : 1,
    maxPulses: Number.isFinite(opts.maxPulses) ? opts.maxPulses : 64,
    soft: wantSoft,
  });
}
