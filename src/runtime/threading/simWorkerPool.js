/**
 * Optional multi-worker compute pool for ExperimentSimBackend.
 *
 * Slot 0 — primary (mix / FD / field lines / optics samples)
 * Slot 1 — secondary continuous particles (convection / hall / ideal-gas)
 *
 * Each slot is **exclusive**: at most one live SimBackend may own a slot.
 * Concurrent acquire on a busy slot returns null so the caller spawns a
 * dedicated Worker (avoids two backends fighting one runner / onmessage).
 * On release, the worker stays warm for the next exclusive owner.
 *
 * Hosts pin via createSimBackend({ workerSlot }) or preferredWorkerSlot(kind).
 * Pool is lazy: workers spawn on first acquire.
 *
 * Flags:
 *   globalThis.__SIM_WORKER_POOL_SIZE__ = 1 | 2   (default 2 when Worker exists)
 *   globalThis.__SIM_WORKER_POOL__ = false         disable pool (always new Worker)
 */

const DEFAULT_URL = () => new URL('./sim.worker.js', import.meta.url);

/** @type {Map<number, Worker>} */
const pool = new Map();
/** @type {Map<number, number>} exclusive ownership refcounts (0 or 1 in practice) */
const refs = new Map();

/**
 * @returns {number}
 */
export function resolveSimWorkerPoolSize() {
  if (typeof globalThis !== 'undefined' && globalThis.__SIM_WORKER_POOL__ === false) {
    return 0;
  }
  const raw = typeof globalThis !== 'undefined'
    ? globalThis.__SIM_WORKER_POOL_SIZE__
    : null;
  if (raw === 0 || raw === 1 || raw === 2) return raw;
  // Default: two slots when Workers exist; zero in Node/tests without Worker.
  if (typeof Worker === 'undefined') return 0;
  return 2;
}

/**
 * @param {number} slot
 * @param {{
 *   WorkerCtor?: typeof Worker,
 *   workerUrl?: URL | string,
 * }} [options]
 * @returns {Worker | null} pooled worker, or null if pool disabled / slot busy
 */
export function acquireSimWorker(slot = 0, options = {}) {
  const size = resolveSimWorkerPoolSize();
  if (size <= 0) return null;
  const s = Math.max(0, Math.min(size - 1, slot | 0));
  const WorkerCtor = options.WorkerCtor || (typeof Worker !== 'undefined' ? Worker : null);
  if (!WorkerCtor) return null;

  // Exclusive: one backend per slot. Busy → null (dedicated Worker fallback).
  if ((refs.get(s) || 0) > 0) return null;

  let worker = pool.get(s);
  if (!worker) {
    worker = new WorkerCtor(
      options.workerUrl || DEFAULT_URL(),
      { type: 'module' },
    );
    pool.set(s, worker);
  }
  refs.set(s, 1);
  return worker;
}

/**
 * Release exclusive ownership of a pooled slot.
 * Keeps the Worker warm for the next owner (init/reinit rebinds the kind).
 * @param {number} slot
 * @param {Worker} [worker]
 */
export function releaseSimWorker(slot = 0, worker) {
  const s = slot | 0;
  const current = pool.get(s);
  if (worker && current && worker !== current) {
    // Ad-hoc worker not from pool — terminate directly.
    try { worker.terminate?.(); } catch { /* ignore */ }
    return;
  }
  if (!current) return;
  refs.set(s, 0);
  // Keep warm — disposeSimWorkerPool() still terminates on shutdown.
}

/** Test / shutdown helper — kill every pooled worker. */
export function disposeSimWorkerPool() {
  for (const worker of pool.values()) {
    try { worker.terminate?.(); } catch { /* ignore */ }
  }
  pool.clear();
  refs.clear();
}

export function simWorkerPoolStats() {
  return {
    size: resolveSimWorkerPoolSize(),
    live: [...pool.keys()],
    refs: Object.fromEntries(refs),
    busy: [...refs.entries()].filter(([, n]) => n > 0).map(([s]) => s),
  };
}
