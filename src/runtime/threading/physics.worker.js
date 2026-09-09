/**
 * Physics Worker — owns a cannon-es world via createMainPhysicsBackend.
 *
 * Protocol (Main → Worker):
 *   { type: 'init', options?, sharedBuffer?: SharedArrayBuffer }
 *   { type: 'attachShared', sharedBuffer: SharedArrayBuffer, capacitySlots }
 *   { type: 'addBody', requestId, desc }
 *   { type: 'removeBody', requestId, bodyId }
 *   { type: 'command', requestId?, bodyId, op, payload }
 *   { type: 'setGravity', x, y, z }
 *   { type: 'batch', requestId, commands: [...], step?: { dt, forceStep } }
 *   { type: 'step', requestId, dt, forceStep? }
 *   { type: 'resetClock' }
 *   { type: 'dispose' }
 *
 * Protocol (Worker → Main):
 *   { type: 'ready', shared?: boolean }
 *   { type: 'added', requestId, bodyId, slot }
 *   { type: 'removed', requestId, bodyId, ok }
 *   { type: 'poses', requestId?, sab?: boolean, simTime, steps, skipped, bodyCount, dynamicCount, buffer? }
 *   { type: 'error', requestId?, message }
 */

import { createMainPhysicsBackend } from './physicsBackend.main.js';
import {
  publishSharedPoses,
  wrapSharedPoseBuffer,
} from './sharedPoseBuffer.js';

/** @type {ReturnType<typeof createMainPhysicsBackend> | null} */
let backend = null;

/** @type {{ sab: SharedArrayBuffer, i32: Int32Array, f32: Float32Array, capacitySlots: number } | null} */
let shared = null;

function ensureBackend(options = {}) {
  if (!backend) backend = createMainPhysicsBackend(options);
  return backend;
}

function attachShared(sab, capacitySlots) {
  if (!sab) {
    shared = null;
    return false;
  }
  const views = wrapSharedPoseBuffer(sab);
  const cap = capacitySlots
    || (typeof Atomics !== 'undefined'
      ? Atomics.load(views.i32, 1) // SAB_I32.CAPACITY_SLOTS
      : Math.floor((sab.byteLength - 32) / 4 / 10));
  shared = { sab, ...views, capacitySlots: cap || 8 };
  return true;
}

function poseTransferCopy(view) {
  // Copy so the worker keeps its internal buffer; transfer the copy.
  const copy = new Float32Array(view.length);
  copy.set(view);
  return copy;
}

function emitPoses(phy, result, requestId) {
  const meta = {
    type: 'poses',
    requestId,
    simTime: result.simTime,
    steps: result.steps,
    skipped: result.skipped,
    bodyCount: phy.bodyCount,
    dynamicCount: phy.dynamicCount,
  };

  if (shared) {
    // Pose buffer is slot-dense (may have holes); size by float count / stride.
    const neededSlots = Math.max(
      1,
      Math.ceil((result.poses?.length || 0) / 10),
      phy.bodyCount,
    );
    if (shared.capacitySlots < neededSlots) {
      // Main must grow + re-attach; fall back to transfer this frame.
      const buffer = poseTransferCopy(result.poses);
      return {
        ...meta,
        sab: false,
        needCapacity: neededSlots,
        buffer,
        transfer: [buffer.buffer],
      };
    }
    publishSharedPoses(shared, {
      simTime: result.simTime,
      steps: result.steps,
      skipped: result.skipped,
      bodyCount: phy.bodyCount,
      dynamicCount: phy.dynamicCount,
      poses: result.poses,
    });
    return { ...meta, sab: true };
  }

  const buffer = poseTransferCopy(result.poses);
  return {
    ...meta,
    sab: false,
    buffer,
    transfer: [buffer.buffer],
  };
}

function applyCommand(phy, cmd) {
  if (!cmd || !cmd.op) return;
  if (cmd.op === 'setGravity') {
    phy.setGravity(cmd.x ?? cmd.payload?.x, cmd.y ?? cmd.payload?.y, cmd.z ?? cmd.payload?.z);
    return;
  }
  if (cmd.op === 'addBody') {
    phy.addBody(cmd.desc || cmd.payload || {});
    return;
  }
  if (cmd.op === 'removeBody') {
    phy.removeBody(cmd.bodyId ?? cmd.payload?.bodyId);
    return;
  }
  phy.command(cmd.bodyId, cmd.op, cmd.payload || {});
}

function handleMessage(data) {
  const type = data?.type;
  try {
    switch (type) {
      case 'init': {
        if (backend) backend.dispose();
        backend = createMainPhysicsBackend(data.options || {});
        shared = null;
        if (data.sharedBuffer) {
          attachShared(data.sharedBuffer, data.capacitySlots);
        }
        return {
          type: 'ready',
          kind: backend.kind,
          shared: !!shared,
        };
      }
      case 'attachShared': {
        const ok = attachShared(data.sharedBuffer, data.capacitySlots);
        return {
          type: 'acked',
          requestId: data.requestId,
          shared: ok,
          capacitySlots: shared?.capacitySlots || 0,
        };
      }
      case 'detachShared': {
        shared = null;
        return { type: 'acked', requestId: data.requestId, shared: false };
      }
      case 'addBody': {
        const phy = ensureBackend();
        const bodyId = phy.addBody(data.desc || {});
        return {
          type: 'added',
          requestId: data.requestId,
          bodyId,
          slot: phy.getSlot(bodyId),
        };
      }
      case 'removeBody': {
        const phy = ensureBackend();
        const ok = phy.removeBody(data.bodyId);
        return { type: 'removed', requestId: data.requestId, bodyId: data.bodyId, ok };
      }
      case 'command': {
        const phy = ensureBackend();
        applyCommand(phy, data);
        return data.requestId != null
          ? { type: 'acked', requestId: data.requestId }
          : null;
      }
      case 'setGravity': {
        ensureBackend().setGravity(data.x, data.y, data.z);
        return null;
      }
      case 'resetClock': {
        ensureBackend().resetClock();
        return null;
      }
      case 'step': {
        const phy = ensureBackend();
        const result = phy.step(data.dt, { forceStep: data.forceStep === true });
        return emitPoses(phy, result, data.requestId);
      }
      case 'batch': {
        const phy = ensureBackend();
        const commands = data.commands || [];
        for (const cmd of commands) applyCommand(phy, cmd);
        if (data.step) {
          const result = phy.step(data.step.dt, { forceStep: data.step.forceStep === true });
          return emitPoses(phy, result, data.requestId);
        }
        return {
          type: 'acked',
          requestId: data.requestId,
          bodyCount: phy.bodyCount,
          dynamicCount: phy.dynamicCount,
        };
      }
      case 'dispose': {
        backend?.dispose();
        backend = null;
        shared = null;
        return { type: 'disposed', requestId: data.requestId };
      }
      default:
        return { type: 'error', requestId: data?.requestId, message: `Unknown message type: ${type}` };
    }
  } catch (error) {
    return {
      type: 'error',
      requestId: data?.requestId,
      message: error?.message || String(error),
    };
  }
}

// Real worker entry
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (event) => {
    const response = handleMessage(event.data);
    if (!response) return;
    const transfer = response.transfer || [];
    delete response.transfer;
    self.postMessage(response, transfer);
  };
}

export { handleMessage, attachShared };
