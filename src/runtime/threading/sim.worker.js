/**
 * Generic Experiment Sim Worker.
 *
 * Protocol (Main → Worker):
 *   { type: 'init', kind, options? }
 *   { type: 'command', requestId?, op, payload? }
 *   { type: 'step', requestId, dt }
 *   { type: 'reinit', requestId?, kind, options? }
 *   { type: 'dispose', requestId? }
 *
 * Protocol (Worker → Main):
 *   { type: 'ready', kind }
 *   { type: 'snapshot', requestId?, …snapshot, transfer? }
 *   { type: 'acked', requestId }
 *   { type: 'error', requestId?, message }
 */

import { createSimKind } from './simKinds/index.js';

/** @type {ReturnType<typeof createSimKind> | null} */
let runner = null;

function createRunner(kind, options = {}) {
  return createSimKind(kind, options);
}

/**
 * Pack snapshot for postMessage; collect transferable ArrayBuffers.
 * @param {object} snap
 * @param {number|string|undefined} requestId
 */
export function packSnapshot(snap, requestId) {
  const message = {
    type: 'snapshot',
    requestId,
    kind: snap.kind,
    simTime: snap.simTime,
    generation: snap.generation,
    steps: snap.steps,
    scalars: snap.scalars || {},
  };
  const transfer = [];
  if (snap.fields) {
    message.fields = {};
    for (const [key, value] of Object.entries(snap.fields)) {
      if (value && typeof value.buffer !== 'undefined') {
        message.fields[key] = value;
        transfer.push(value.buffer);
      } else {
        message.fields[key] = value;
      }
    }
  }
  if (snap.particles) {
    message.particles = snap.particles;
    transfer.push(snap.particles.buffer);
  }
  if (transfer.length) message.transfer = transfer;
  return message;
}

/**
 * @param {object} message
 * @returns {object | null}
 */
export function handleMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const { type, requestId } = message;

  try {
    if (type === 'init') {
      runner?.dispose?.();
      runner = createRunner(message.kind, message.options || {});
      return { type: 'ready', kind: message.kind, requestId };
    }

    if (type === 'reinit') {
      runner?.dispose?.();
      runner = createRunner(message.kind, message.options || {});
      return { type: 'ready', kind: message.kind, requestId };
    }

    if (type === 'command') {
      if (!runner) throw new Error('sim worker not initialized');
      runner.command(message.op, message.payload || {});
      return requestId != null ? { type: 'acked', requestId } : null;
    }

    if (type === 'step') {
      if (!runner) throw new Error('sim worker not initialized');
      const snap = runner.step(message.dt);
      return packSnapshot(snap, requestId);
    }

    if (type === 'dispose') {
      runner?.dispose?.();
      runner = null;
      return { type: 'disposed', requestId };
    }

    return { type: 'error', requestId, message: `Unknown message type: ${type}` };
  } catch (error) {
    return {
      type: 'error',
      requestId,
      message: error?.message || String(error),
    };
  }
}

function installSelf() {
  if (typeof self === 'undefined' || typeof self.postMessage !== 'function') return;
  if (self.__SIM_WORKER_INSTALLED__) return;
  self.__SIM_WORKER_INSTALLED__ = true;
  self.onmessage = (event) => {
    const response = handleMessage(event.data);
    if (!response) return;
    const transfer = response.transfer || [];
    delete response.transfer;
    self.postMessage(response, transfer);
  };
}

installSelf();
