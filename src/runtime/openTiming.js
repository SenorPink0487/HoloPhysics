/**
 * Experiment / station open timing — ring buffer + measure helpers.
 *
 * Used by manager / main open paths and by Playwright measure scripts via
 * `window.__labDebug.measureOpen(...)`.
 */

/**
 * @typedef {{ name: string, t: number, dt: number }} OpenMark
 * @typedef {{
 *   id: number,
 *   kind: string,
 *   meta: Record<string, unknown>,
 *   t0: number,
 *   marks: OpenMark[],
 *   totalMs: number|null,
 *   jobs: Array<{ id: string, dt: number, t: number }>,
 * }} OpenSession
 */

/**
 * @param {{ maxSessions?: number }} [opts]
 */
export function createOpenTiming(opts = {}) {
  const maxSessions = Math.max(4, Math.floor(Number(opts.maxSessions) || 48));
  /** @type {OpenSession[]} */
  const sessions = [];
  /** @type {OpenSession|null} */
  let active = null;
  let seq = 0;

  function nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function begin(kind, meta = {}) {
    // Nesting: close prior session as abandoned so marks stay coherent.
    if (active) {
      active.totalMs = nowMs() - active.t0;
      active.marks.push({
        name: 'abandoned',
        t: active.totalMs,
        dt: 0,
      });
      sessions.push(active);
      if (sessions.length > maxSessions) sessions.shift();
    }
    active = {
      id: (seq += 1),
      kind: String(kind || 'open'),
      meta: meta && typeof meta === 'object' ? { ...meta } : {},
      t0: nowMs(),
      marks: [],
      totalMs: null,
      jobs: [],
    };
    mark('begin');
    return active.id;
  }

  /**
   * @param {string} name
   * @param {Record<string, unknown>} [extra]
   */
  function mark(name, extra = null) {
    if (!active) return null;
    const t = nowMs() - active.t0;
    const prev = active.marks.length
      ? active.marks[active.marks.length - 1].t
      : 0;
    /** @type {OpenMark & Record<string, unknown>} */
    const entry = {
      name: String(name || 'mark'),
      t: Number(t.toFixed(3)),
      dt: Number((t - prev).toFixed(3)),
    };
    if (extra && typeof extra === 'object') {
      Object.assign(entry, extra);
    }
    active.marks.push(entry);
    if (typeof console !== 'undefined' && console.log) {
      console.log(
        `[open-trace] mark ${entry.name} t=${entry.t.toFixed(1)}ms dt=${entry.dt.toFixed(1)}ms`
          + (active.meta?.expId ? ` exp=${active.meta.expId}` : '')
          + (active.meta?.stationId ? ` st=${active.meta.stationId}` : ''),
      );
    }
    return entry;
  }

  /**
   * Record a frame-budget job duration into the active session (if any).
   * @param {string} jobId
   * @param {number} dtMs
   */
  function recordJob(jobId, dtMs) {
    if (!active || !Number.isFinite(dtMs)) return;
    if (dtMs < 4) return;
    active.jobs.push({
      id: String(jobId || 'job'),
      dt: Number(dtMs.toFixed(2)),
      t: Number((nowMs() - active.t0).toFixed(2)),
    });
  }

  function end(extraMeta = null) {
    if (!active) return null;
    if (extraMeta && typeof extraMeta === 'object') {
      Object.assign(active.meta, extraMeta);
    }
    const totalMs = nowMs() - active.t0;
    active.totalMs = Number(totalMs.toFixed(3));
    mark('end');
    const done = active;
    sessions.push(done);
    if (sessions.length > maxSessions) sessions.shift();
    active = null;
    if (typeof console !== 'undefined' && console.log) {
      console.log(
        `[open-trace] session end kind=${done.kind} total=${done.totalMs}ms`
          + (done.meta?.expId ? ` exp=${done.meta.expId}` : '')
          + (done.jobs.length ? ` heavyJobs=${done.jobs.length}` : ''),
      );
    }
    return snapshotSession(done);
  }

  function snapshotSession(s) {
    if (!s) return null;
    return {
      id: s.id,
      kind: s.kind,
      meta: { ...s.meta },
      totalMs: s.totalMs,
      marks: s.marks.map((m) => ({ ...m })),
      jobs: s.jobs.map((j) => ({ ...j })),
      topJobs: s.jobs.slice().sort((a, b) => b.dt - a.dt).slice(0, 12),
    };
  }

  function getActive() {
    return active ? snapshotSession({ ...active, totalMs: nowMs() - active.t0 }) : null;
  }

  function getSessions() {
    return sessions.map(snapshotSession);
  }

  function getLast() {
    return sessions.length ? snapshotSession(sessions[sessions.length - 1]) : null;
  }

  function clear() {
    sessions.length = 0;
    active = null;
  }

  /**
   * Wait until the frame scheduler has no pending switch work (best-effort).
   * @param {{
   *   scheduler?: { pending?: () => number, softSwitchActive?: () => boolean, switchSession?: () => boolean },
   *   settleMs?: number,
   *   timeoutMs?: number,
   * }} [waitOpts]
   */
  async function waitSettled(waitOpts = {}) {
    const scheduler = waitOpts.scheduler || null;
    const settleMs = Number.isFinite(waitOpts.settleMs) ? waitOpts.settleMs : 120;
    const timeoutMs = Number.isFinite(waitOpts.timeoutMs) ? waitOpts.timeoutMs : 4000;
    const ready = typeof waitOpts.ready === 'function' ? waitOpts.ready : null;
    const t0 = nowMs();
    let idleSince = null;
    while (nowMs() - t0 < timeoutMs) {
      const pending = scheduler?.pending?.() || 0;
      const soft = !!scheduler?.softSwitchActive?.();
      const sess = !!scheduler?.switchSession?.();
      const isReady = !ready || !!ready();
      if (pending === 0 && !soft && !sess && isReady) {
        if (idleSince == null) idleSince = nowMs();
        if (nowMs() - idleSince >= settleMs) return true;
      } else {
        idleSince = null;
      }
      await new Promise((r) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r());
        else setTimeout(r, 16);
      });
    }
    return false;
  }

  return {
    begin,
    mark,
    end,
    recordJob,
    getActive,
    getSessions,
    getLast,
    clear,
    waitSettled,
  };
}

/** Shared singleton used by the lab shell. */
export const labOpenTiming = createOpenTiming();
