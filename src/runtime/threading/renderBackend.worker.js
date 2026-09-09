/**
 * Worker-backed RenderBackend proxy (Phase 3).
 *
 * Transfers an HTMLCanvasElement to OffscreenCanvas and drives present via
 * postMessage (latest-complete-wins for in-flight frames).
 *
 * The full lab scene is NOT migrated here — only an isolated primitive world.
 * Use FrameBridge + PhysicsBackend to drive demo / island poses.
 */

import { canUseOffscreenCanvas } from './renderTypes.js';

let nextRequestId = 1;
function allocRequestId() {
  const id = nextRequestId;
  nextRequestId += 1;
  return id;
}

/**
 * @param {{
 *   canvas?: HTMLCanvasElement,
 *   offscreen?: OffscreenCanvas,
 *   worker?: Worker,
 *   workerUrl?: URL | string,
 *   WorkerCtor?: typeof Worker,
 *   width?: number,
 *   height?: number,
 *   pixelRatio?: number,
 *   clearColor?: number,
 *   antialias?: boolean,
 * }} [options]
 */
export function createWorkerRenderBackend(options = {}) {
  const WorkerCtor = options.WorkerCtor || (typeof Worker !== 'undefined' ? Worker : null);
  if (!options.worker && !WorkerCtor) {
    throw new Error('createWorkerRenderBackend: Worker is not available');
  }

  let offscreen = options.offscreen || null;
  const canvas = options.canvas || null;

  if (!offscreen && canvas) {
    if (!canUseOffscreenCanvas() && typeof canvas.transferControlToOffscreen !== 'function') {
      throw new Error('createWorkerRenderBackend: transferControlToOffscreen is not available');
    }
    offscreen = canvas.transferControlToOffscreen();
  }
  if (!offscreen) {
    throw new Error('createWorkerRenderBackend: canvas or offscreen is required');
  }

  const width = Math.max(1, options.width | 0 || canvas?.width || offscreen.width || 1);
  const height = Math.max(1, options.height | 0 || canvas?.height || offscreen.height || 1);
  const pixelRatio = Number(options.pixelRatio) || 1;

  const worker = options.worker || new WorkerCtor(
    options.workerUrl || new URL('./render.worker.js', import.meta.url),
    { type: 'module' },
  );

  let disposed = false;
  let ready = false;
  let initFailed = null;
  let presentInFlight = false;
  let presentQueued = false;
  let lastPresentMs = 0;
  let currentWidth = width;
  let currentHeight = height;
  let currentDpr = pixelRatio;
  /** @type {((value: unknown) => void)[]} */
  const readyWaiters = [];
  /** @type {Map<number, { resolve: Function, reject: Function }>} */
  const pendingRequests = new Map();

  function post(message, transfer = []) {
    if (disposed) return;
    if (transfer.length) worker.postMessage(message, transfer);
    else worker.postMessage(message);
  }

  function onMessage(event) {
    const data = event.data;
    if (!data) return;
    if (data.type === 'ready') {
      ready = true;
      initFailed = null;
      while (readyWaiters.length) readyWaiters.shift()(true);
      return;
    }
    if (data.type === 'error') {
      const pending = data.requestId != null ? pendingRequests.get(data.requestId) : null;
      if (pending) {
        pendingRequests.delete(data.requestId);
        pending.reject(new Error(data.message || 'render worker error'));
      } else if (typeof console !== 'undefined') {
        console.warn('[RenderWorker]', data.message);
      }
      if (!ready) {
        initFailed = new Error(data.message || 'render worker init failed');
        while (readyWaiters.length) readyWaiters.shift()(false);
      }
      presentInFlight = false;
      return;
    }
    if (data.type === 'presented') {
      lastPresentMs = Number(data.ms) || 0;
      const pending = data.requestId != null ? pendingRequests.get(data.requestId) : null;
      if (pending) {
        pendingRequests.delete(data.requestId);
        pending.resolve(data);
      }
      presentInFlight = false;
      if (presentQueued && !disposed) {
        presentQueued = false;
        flushPresent();
      }
      return;
    }
    if (data.type === 'acked' || data.type === 'disposed') {
      const pending = data.requestId != null ? pendingRequests.get(data.requestId) : null;
      if (pending) {
        pendingRequests.delete(data.requestId);
        pending.resolve(data);
      }
    }
  }

  worker.addEventListener?.('message', onMessage);
  worker.onmessage = onMessage;

  // Transfer OffscreenCanvas to the worker (neutered on this side after).
  post({
    type: 'init',
    canvas: offscreen,
    width,
    height,
    pixelRatio,
    clearColor: options.clearColor,
    antialias: options.antialias !== false,
  }, [offscreen]);

  function whenReady() {
    if (ready) return Promise.resolve(true);
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  function request(message, transfer = []) {
    const requestId = allocRequestId();
    message.requestId = requestId;
    return new Promise((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject });
      post(message, transfer);
    });
  }

  function flushPresent() {
    if (disposed) return { presented: false, ms: lastPresentMs, deferred: true };
    if (presentInFlight) {
      presentQueued = true;
      return { presented: false, ms: lastPresentMs, deferred: true };
    }
    presentInFlight = true;
    const requestId = allocRequestId();
    pendingRequests.set(requestId, {
      resolve: () => {},
      reject: (err) => {
        if (typeof console !== 'undefined') console.warn('[RenderWorker] present failed', err);
        presentInFlight = false;
      },
    });
    post({ type: 'present', requestId });
    return { presented: true, ms: lastPresentMs, deferred: true };
  }

  return {
    kind: 'worker',
    worker,
    whenReady,

    get lastPresentMs() { return lastPresentMs; },
    get width() { return currentWidth; },
    get height() { return currentHeight; },
    get pixelRatio() { return currentDpr; },

    resize(w, h, dpr) {
      if (disposed) return false;
      currentWidth = Math.max(1, w | 0);
      currentHeight = Math.max(1, h | 0);
      if (dpr != null) currentDpr = Number(dpr) || 1;
      post({
        type: 'resize',
        width: currentWidth,
        height: currentHeight,
        pixelRatio: currentDpr,
      });
      return true;
    },

    setCamera(camera) {
      if (disposed) return false;
      post({ type: 'setCamera', camera });
      return true;
    },

    setClearColor(color, alpha) {
      if (disposed) return false;
      post({ type: 'setClearColor', color, alpha });
      return true;
    },

    upsertMesh(mesh) {
      if (disposed) return false;
      post({ type: 'upsertMesh', mesh });
      return true;
    },

    removeMesh(id) {
      if (disposed) return false;
      post({ type: 'removeMesh', id });
      return true;
    },

    /**
     * @param {Float32Array|ArrayLike<number>} buffer pose buffer
     * @param {{ stride?: number, idOrder?: Array<number|string> }} [opts]
     */
    applyPoses(buffer, opts = {}) {
      if (disposed || !buffer) return false;
      // Copy so caller retains ownership; worker does not transfer-detach.
      const copy = buffer instanceof Float32Array
        ? buffer.slice()
        : Float32Array.from(buffer);
      post({
        type: 'applyPoses',
        buffer: copy,
        stride: opts.stride,
        idOrder: opts.idOrder || null,
      }, [copy.buffer]);
      return true;
    },

    present() {
      return flushPresent();
    },

    async presentAsync() {
      await whenReady();
      if (initFailed) throw initFailed;
      const data = await request({ type: 'present' });
      lastPresentMs = Number(data.ms) || 0;
      presentInFlight = false;
      return { presented: true, ms: lastPresentMs, deferred: false };
    },

    dispose() {
      if (disposed) return false;
      disposed = true;
      try { post({ type: 'dispose', requestId: allocRequestId() }); } catch { /* ignore */ }
      try { worker.terminate?.(); } catch { /* ignore */ }
      pendingRequests.clear();
      return true;
    },
  };
}
