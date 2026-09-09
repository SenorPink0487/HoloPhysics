/**
 * Worker-backed ExperimentSimBackend proxy (latest-complete-wins).
 *
 * Optionally pins a slot from simWorkerPool so continuous particle kinds
 * (convection / hall / ideal-gas) can share a second compute worker with
 * the primary slot used by mix / FD / field lines / optics samples.
 */

import {
  acquireSimWorker,
  releaseSimWorker,
  resolveSimWorkerPoolSize,
} from './simWorkerPool.js';
import { preferredWorkerSlot } from './simTypes.js';

let nextRequestId = 1;
function allocRequestId() {
  const id = nextRequestId;
  nextRequestId += 1;
  return id;
}

/**
 * @param {{
 *   kind: string,
 *   options?: object,
 *   worker?: Worker,
 *   WorkerCtor?: typeof Worker,
 *   workerUrl?: URL | string,
 *   workerSlot?: number,
 *   usePool?: boolean,
 * }} [config]
 */
export function createWorkerSimBackend(config = {}) {
  const kindId = config.kind || config.options?.kind;
  if (!kindId) throw new TypeError('createWorkerSimBackend: kind is required');

  const WorkerCtor = config.WorkerCtor || (typeof Worker !== 'undefined' ? Worker : null);
  if (!config.worker && !WorkerCtor) {
    throw new Error('createWorkerSimBackend: Worker is not available');
  }

  const preferSlot = config.workerSlot != null
    ? (config.workerSlot | 0)
    : preferredWorkerSlot(kindId);
  const usePool = config.usePool !== false
    && !config.worker
    && resolveSimWorkerPoolSize() > 0;

  let pooled = false;
  let workerSlot = preferSlot;
  let worker = config.worker || null;

  if (!worker && usePool) {
    worker = acquireSimWorker(preferSlot, {
      WorkerCtor,
      workerUrl: config.workerUrl,
    });
    if (worker) {
      pooled = true;
      workerSlot = preferSlot;
    }
  }

  if (!worker) {
    worker = new WorkerCtor(
      config.workerUrl || new URL('./sim.worker.js', import.meta.url),
      { type: 'module' },
    );
    pooled = false;
    workerSlot = preferSlot;
  }

  let disposed = false;
  let ready = false;
  const readyWaiters = [];
  const pendingRequests = new Map();
  let stepInFlight = false;
  let queuedDt = 0;
  let lastSnapshot = {
    kind: kindId,
    simTime: 0,
    generation: 0,
    steps: 0,
    scalars: {},
  };
  let simTime = 0;
  let simKind = kindId;

  function post(message, transfer) {
    if (disposed) return;
    if (transfer?.length) worker.postMessage(message, transfer);
    else worker.postMessage(message);
  }

  function settleReady() {
    ready = true;
    while (readyWaiters.length) readyWaiters.shift()?.(true);
  }

  function onMessage(event) {
    const data = event?.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'ready') {
      settleReady();
      if (data.requestId != null && pendingRequests.has(data.requestId)) {
        pendingRequests.get(data.requestId).resolve(data);
        pendingRequests.delete(data.requestId);
      }
      return;
    }

    if (data.type === 'snapshot') {
      stepInFlight = false;
      lastSnapshot = {
        kind: data.kind || simKind,
        simTime: data.simTime,
        generation: data.generation,
        steps: data.steps,
        scalars: data.scalars || {},
        fields: data.fields || undefined,
        particles: data.particles || undefined,
      };
      simTime = data.simTime || simTime;
      if (data.requestId != null && pendingRequests.has(data.requestId)) {
        pendingRequests.get(data.requestId).resolve(lastSnapshot);
        pendingRequests.delete(data.requestId);
      }
      // Drain coalesced dt with one more step (still latest-complete-wins).
      if (queuedDt > 0 && !disposed) {
        const dt = Math.min(queuedDt, 0.05);
        queuedDt = 0;
        flushStep(dt);
      }
      return;
    }

    if (data.type === 'acked' || data.type === 'disposed') {
      if (data.requestId != null && pendingRequests.has(data.requestId)) {
        pendingRequests.get(data.requestId).resolve(data);
        pendingRequests.delete(data.requestId);
      }
      return;
    }

    if (data.type === 'error') {
      stepInFlight = false;
      if (data.requestId != null && pendingRequests.has(data.requestId)) {
        pendingRequests.get(data.requestId).reject(new Error(data.message || 'sim worker error'));
        pendingRequests.delete(data.requestId);
      } else if (typeof console !== 'undefined') {
        console.warn('[SimWorker]', data.message);
      }
    }
  }

  worker.addEventListener?.('message', onMessage);
  worker.onmessage = onMessage;

  post({ type: 'init', kind: kindId, options: config.options || {} });

  function whenReady() {
    if (ready) return Promise.resolve(true);
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  function flushStep(dt) {
    if (disposed) {
      return { ...lastSnapshot, skipped: true, deferred: false };
    }
    if (stepInFlight) {
      queuedDt = Math.min(queuedDt + dt, 0.1);
      return { ...lastSnapshot, skipped: true, deferred: true };
    }
    stepInFlight = true;
    const requestId = allocRequestId();
    pendingRequests.set(requestId, {
      resolve: () => {},
      reject: (err) => {
        stepInFlight = false;
        if (typeof console !== 'undefined') console.warn('[SimWorker] step failed', err);
      },
    });
    post({ type: 'step', requestId, dt });
    return { ...lastSnapshot, deferred: true, skipped: false };
  }

  return {
    kind: 'worker',
    simKind,
    worker,
    workerSlot,
    pooled,
    whenReady,

    get simTime() { return simTime; },
    get generation() { return lastSnapshot?.generation || 0; },
    get lastSnapshot() { return lastSnapshot; },

    command(op, payload) {
      if (disposed) return false;
      post({ type: 'command', op, payload: payload || {} });
      return true;
    },

    step(dt) {
      return flushStep(dt);
    },

    async stepAsync(dt) {
      if (disposed) return { ...lastSnapshot, skipped: true };
      await whenReady();
      // Wait out any in-flight step so the next result matches this dt call.
      while (stepInFlight) {
        await new Promise((r) => setTimeout(r, 0));
      }
      const requestId = allocRequestId();
      stepInFlight = true;
      const resultPromise = new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });
      });
      post({ type: 'step', requestId, dt });
      const snap = await resultPromise;
      return { ...snap, deferred: false, skipped: false };
    },

    getSnapshot() {
      return lastSnapshot;
    },

    reinit(nextKind, options = {}) {
      if (disposed) return false;
      simKind = nextKind || simKind;
      post({ type: 'reinit', kind: simKind, options });
      ready = false;
      return true;
    },

    dispose() {
      if (disposed) return false;
      disposed = true;
      try {
        post({ type: 'dispose' });
      } catch { /* ignore */ }
      try {
        worker.removeEventListener?.('message', onMessage);
        if (worker.onmessage === onMessage) worker.onmessage = null;
      } catch { /* ignore */ }
      try {
        if (pooled) {
          releaseSimWorker(workerSlot, worker);
        } else {
          worker.terminate?.();
        }
      } catch { /* ignore */ }
      pendingRequests.clear();
      return true;
    },
  };
}
