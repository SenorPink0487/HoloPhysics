/**
 * Worker-backed PhysicsBackend proxy (Phase 1 + Phase 2 SAB).
 *
 * - Body creation is synchronous on main: client allocates bodyId, shadows a
 *   handle immediately, and queues `addBody` for the next worker batch.
 * - step() is non-blocking: returns last complete poses (latest-complete-wins).
 * - When SharedArrayBuffer is available (COOP/COEP), poses are published into
 *   a shared ring with Atomics generation; otherwise transferable copies.
 * - BodyHandle mutates a local shadow pose and enqueues worker commands.
 *
 * Fallback to main is the caller's responsibility (createPhysicsBackend).
 */

import {
  BODY_TYPE,
  DEFAULT_FIXED_DT,
  DEFAULT_MAX_SUBSTEPS,
  POSE_STRIDE,
  writePose,
} from './types.js';
import {
  createSharedPoseBuffer,
  ensureSharedPoseCapacity,
  readSharedPoses,
  shouldUseSharedPoses,
} from './sharedPoseBuffer.js';

let nextRequestId = 1;
function allocRequestId() {
  const id = nextRequestId;
  nextRequestId += 1;
  return id;
}

/** Main-thread body ids — worker respects desc.id so handles stay stable. */
let nextBodyId = 1;
function allocBodyId() {
  const id = nextBodyId;
  nextBodyId += 1;
  return id;
}

function resolveType(desc = {}) {
  if (desc.type != null) return desc.type;
  if (desc.mass === 0 || desc.static) return BODY_TYPE.STATIC;
  return BODY_TYPE.DYNAMIC;
}

function createShadowHandle(proxy, bodyId) {
  const state = proxy._shadows.get(bodyId);
  const vec = (field) => ({
    get x() { return state[field][0]; },
    get y() { return state[field][1]; },
    get z() { return state[field][2]; },
    set x(v) { state[field][0] = v; proxy._queuePose(bodyId); },
    set y(v) { state[field][1] = v; proxy._queuePose(bodyId); },
    set z(v) { state[field][2] = v; proxy._queuePose(bodyId); },
    set(x = 0, y = 0, z = 0) {
      state[field][0] = x;
      state[field][1] = y;
      state[field][2] = z;
      proxy._queuePose(bodyId);
      return this;
    },
    setZero() { return this.set(0, 0, 0); },
    copy(other) {
      return this.set(Number(other?.x) || 0, Number(other?.y) || 0, Number(other?.z) || 0);
    },
  });

  return {
    id: bodyId,
    get type() { return state.type; },
    set type(value) {
      state.type = value;
      proxy._enqueue({ op: 'setType', bodyId, payload: { type: value } });
      proxy._recomputeDynamicCount();
    },
    get mass() { return state.mass; },
    set mass(value) {
      state.mass = Number(value) || 0;
      proxy._enqueue({ op: 'setMass', bodyId, payload: { mass: state.mass } });
      proxy._recomputeDynamicCount();
    },
    get collisionResponse() { return state.collisionResponse; },
    set collisionResponse(value) {
      state.collisionResponse = !!value;
      proxy._enqueue({ op: 'setCollisionResponse', bodyId, payload: { value: !!value } });
    },
    position: vec('position'),
    velocity: vec('velocity'),
    angularVelocity: vec('angularVelocity'),
    quaternion: {
      get x() { return state.quaternion[0]; },
      get y() { return state.quaternion[1]; },
      get z() { return state.quaternion[2]; },
      get w() { return state.quaternion[3]; },
      set(x, y, z, w) {
        state.quaternion = [x, y, z, w];
        proxy._queuePose(bodyId);
        return this;
      },
      setFromEuler(x = 0, y = 0, z = 0) {
        // Approximate via worker: send euler in setPose.
        state.euler = [x, y, z];
        proxy._enqueue({
          op: 'setPose',
          bodyId,
          payload: {
            position: [...state.position],
            euler: [x, y, z],
          },
        });
        return this;
      },
      copy(other) {
        return this.set(
          Number(other?.x) || 0,
          Number(other?.y) || 0,
          Number(other?.z) || 0,
          Number(other?.w) || 1,
        );
      },
    },
    wakeUp() { proxy._enqueue({ op: 'wake', bodyId, payload: {} }); },
    sleep() { proxy._enqueue({ op: 'sleep', bodyId, payload: {} }); },
    updateMassProperties() {
      proxy._enqueue({ op: 'setMass', bodyId, payload: { mass: state.mass } });
    },
  };
}

/**
 * @param {{
 *   worker?: Worker,
 *   workerUrl?: URL | string,
 *   fixedDt?: number,
 *   maxSubSteps?: number,
 *   gravity?: [number, number, number],
 *   WorkerCtor?: typeof Worker,
 *   useSharedBuffer?: boolean,
 *   forceSharedBuffer?: boolean,
 * }} [options]
 */
export function createWorkerPhysicsBackend(options = {}) {
  const fixedDt = options.fixedDt ?? DEFAULT_FIXED_DT;
  const maxSubSteps = options.maxSubSteps ?? DEFAULT_MAX_SUBSTEPS;
  /** @type {[number, number, number]} */
  const gravity = [...(options.gravity || [0, -9.81, 0])];

  const wantShared = options.useSharedBuffer !== false
    && shouldUseSharedPoses({ force: options.forceSharedBuffer === true });

  /** @type {Map<number, object>} */
  const shadows = new Map();
  /** bodyId → slot */
  const slots = new Map();
  /** Pending addBody descs not yet confirmed by worker (slot may be provisional). */
  const pendingAdds = new Map();
  const pendingCommands = [];
  let poses = new Float32Array(0);
  let simTime = 0;
  let dynamicCount = 0;
  let bodyCount = 0;
  let nextSlot = 0;
  let disposed = false;
  let stepInFlight = false;
  let queuedDt = 0;
  let ready = false;
  let initFailed = null;
  let sharedEnabled = false;
  /** @type {ReturnType<typeof createSharedPoseBuffer> | null} */
  let sharedBundle = null;
  let lastSharedGeneration = 0;
  /** @type {((value: unknown) => void)[]} */
  const readyWaiters = [];
  /** @type {Map<number, { resolve: Function, reject: Function }>} */
  const pendingRequests = new Map();

  const WorkerCtor = options.WorkerCtor || (typeof Worker !== 'undefined' ? Worker : null);
  if (!options.worker && !WorkerCtor) {
    throw new Error('createWorkerPhysicsBackend: Worker is not available');
  }

  const worker = options.worker || new WorkerCtor(
    options.workerUrl || new URL('./physics.worker.js', import.meta.url),
    { type: 'module' },
  );

  if (wantShared) {
    try {
      sharedBundle = createSharedPoseBuffer(8);
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.info('[PhysicsWorker] SAB unavailable, using transferable poses', error?.message || error);
      }
      sharedBundle = null;
    }
  }

  function recomputeDynamicCount() {
    dynamicCount = 0;
    for (const state of shadows.values()) {
      if (state.type === BODY_TYPE.DYNAMIC && state.mass > 0) dynamicCount += 1;
    }
  }

  function enqueue(cmd) {
    pendingCommands.push(cmd);
  }

  function queuePose(bodyId) {
    const state = shadows.get(bodyId);
    if (!state) return;
    const payload = {
      position: [...state.position],
      velocity: [...state.velocity],
      angularVelocity: [...state.angularVelocity],
    };
    if (state.euler) {
      payload.euler = state.euler;
      state.euler = null;
    } else {
      payload.quaternion = [...state.quaternion];
    }
    enqueue({ op: 'setPose', bodyId, payload: { position: payload.position, quaternion: payload.quaternion, euler: payload.euler } });
    enqueue({
      op: 'setVelocity',
      bodyId,
      payload: {
        velocity: payload.velocity,
        angularVelocity: payload.angularVelocity,
      },
    });
  }

  function post(message, transfer = []) {
    if (disposed) return;
    if (transfer.length) worker.postMessage(message, transfer);
    else worker.postMessage(message);
  }

  function ensurePoseCapacity(slotCount) {
    const need = slotCount * POSE_STRIDE;
    if (poses.length < need) {
      const next = new Float32Array(Math.max(need, poses.length ? poses.length * 2 : POSE_STRIDE * 4));
      next.set(poses);
      poses = next;
    }
  }

  function ensureSharedCapacity(slotCount) {
    if (!sharedBundle) return;
    const next = ensureSharedPoseCapacity(sharedBundle, slotCount);
    if (next !== sharedBundle) {
      sharedBundle = next;
      // Re-attach grown buffer to worker.
      post({
        type: 'attachShared',
        requestId: allocRequestId(),
        sharedBuffer: sharedBundle.sab,
        capacitySlots: sharedBundle.capacitySlots,
      });
    }
  }

  function refreshShadowsFromPoses() {
    for (const [bodyId, state] of shadows) {
      const slot = slots.get(bodyId);
      if (slot == null || !poses.length) continue;
      const o = slot * POSE_STRIDE;
      if (o + POSE_STRIDE > poses.length) continue;
      state.position[0] = poses[o];
      state.position[1] = poses[o + 1];
      state.position[2] = poses[o + 2];
      state.quaternion[0] = poses[o + 3];
      state.quaternion[1] = poses[o + 4];
      state.quaternion[2] = poses[o + 5];
      state.quaternion[3] = poses[o + 6];
      state.velocity[0] = poses[o + 7];
      state.velocity[1] = poses[o + 8];
      state.velocity[2] = poses[o + 9];
    }
  }

  function applyPosesBuffer(buffer, meta = {}) {
    if (buffer && buffer.length) {
      if (poses.length !== buffer.length) poses = new Float32Array(buffer.length);
      else poses.set(buffer);
    }
    if (meta.simTime != null) simTime = meta.simTime;
    if (meta.bodyCount != null) bodyCount = meta.bodyCount;
    if (meta.dynamicCount != null) dynamicCount = meta.dynamicCount;
    refreshShadowsFromPoses();
  }

  function pullSharedPoses(meta = {}) {
    if (!sharedBundle) return false;
    // Grow local mirror first so read can fill it.
    ensurePoseCapacity(Math.max(nextSlot, meta.bodyCount || bodyCount || 1));
    const frame = readSharedPoses(sharedBundle, poses);
    if (!frame) return false;
    if (frame.generation === lastSharedGeneration && meta.force !== true) {
      // Same published frame — still apply meta if provided.
      if (meta.simTime != null) simTime = meta.simTime;
      return true;
    }
    lastSharedGeneration = frame.generation;
    // readSharedPoses may return a subarray; normalize to owned buffer length.
    if (frame.poses !== poses) {
      if (poses.length < frame.poses.length) {
        poses = new Float32Array(frame.poses.length);
      }
      poses.set(frame.poses);
    }
    simTime = frame.simTime;
    bodyCount = frame.bodyCount;
    dynamicCount = frame.dynamicCount;
    refreshShadowsFromPoses();
    return true;
  }

  function onMessage(event) {
    const data = event.data;
    if (!data) return;
    if (data.type === 'ready') {
      ready = true;
      initFailed = null;
      sharedEnabled = !!data.shared && !!sharedBundle;
      while (readyWaiters.length) readyWaiters.shift()(true);
      return;
    }
    if (data.type === 'error') {
      const pending = data.requestId != null ? pendingRequests.get(data.requestId) : null;
      if (pending) {
        pendingRequests.delete(data.requestId);
        pending.reject(new Error(data.message || 'physics worker error'));
      } else if (typeof console !== 'undefined') {
        console.warn('[PhysicsWorker]', data.message);
      }
      if (!ready) {
        initFailed = new Error(data.message || 'physics worker init failed');
        while (readyWaiters.length) readyWaiters.shift()(false);
      }
      stepInFlight = false;
      return;
    }
    if (data.type === 'added') {
      if (data.bodyId != null && data.slot != null) {
        slots.set(data.bodyId, data.slot);
        pendingAdds.delete(data.bodyId);
        if (data.slot >= nextSlot) nextSlot = data.slot + 1;
        ensurePoseCapacity(nextSlot);
        ensureSharedCapacity(nextSlot);
      }
      const pending = pendingRequests.get(data.requestId);
      if (pending) {
        pendingRequests.delete(data.requestId);
        pending.resolve(data);
      }
      return;
    }
    if (data.type === 'poses') {
      if (data.sab && sharedBundle) {
        if (data.needCapacity) ensureSharedCapacity(data.needCapacity);
        pullSharedPoses({ ...data, force: true });
      } else {
        applyPosesBuffer(data.buffer, data);
        if (data.needCapacity) ensureSharedCapacity(data.needCapacity);
      }
      const pending = data.requestId != null ? pendingRequests.get(data.requestId) : null;
      if (pending) {
        pendingRequests.delete(data.requestId);
        pending.resolve(data);
      }
      stepInFlight = false;
      // If dt accumulated while in-flight, flush another step.
      if (queuedDt > 0 && !disposed) {
        const dt = Math.min(queuedDt, fixedDt * 2);
        queuedDt = 0;
        flushStep(dt);
      }
      return;
    }
    if (data.type === 'acked' || data.type === 'removed' || data.type === 'disposed') {
      if (data.type === 'acked' && data.shared != null) {
        sharedEnabled = !!data.shared;
      }
      const pending = data.requestId != null ? pendingRequests.get(data.requestId) : null;
      if (pending) {
        pendingRequests.delete(data.requestId);
        pending.resolve(data);
      }
    }
  }

  worker.addEventListener?.('message', onMessage);
  worker.onmessage = onMessage;

  const initMessage = {
    type: 'init',
    options: { fixedDt, maxSubSteps, gravity },
  };
  if (sharedBundle) {
    initMessage.sharedBuffer = sharedBundle.sab;
    initMessage.capacitySlots = sharedBundle.capacitySlots;
  }
  post(initMessage);

  function whenReady() {
    if (ready) return Promise.resolve(true);
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  function request(message) {
    const requestId = allocRequestId();
    message.requestId = requestId;
    return new Promise((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject });
      post(message);
    });
  }

  function drainPendingAddCommands() {
    const adds = [];
    for (const [bodyId, desc] of pendingAdds) {
      adds.push({ op: 'addBody', bodyId, desc: { ...desc, id: bodyId } });
    }
    pendingAdds.clear();
    return adds;
  }

  function flushStep(dt, opts = {}) {
    if (disposed) {
      return { simTime, steps: 0, poses, skipped: true };
    }
    if (stepInFlight) {
      queuedDt = Math.min(queuedDt + dt, fixedDt * 4);
      return { simTime, steps: 0, poses, skipped: true, deferred: true };
    }
    stepInFlight = true;
    // Fold deferred addBody into the same batch so step never races creation.
    const commands = [
      ...drainPendingAddCommands(),
      ...pendingCommands.splice(0, pendingCommands.length),
    ];
    const requestId = allocRequestId();
    // Fire-and-forget; result applied in onMessage. Callers read last poses.
    pendingRequests.set(requestId, {
      resolve: () => {},
      reject: (err) => {
        if (typeof console !== 'undefined') console.warn('[PhysicsWorker] step failed', err);
        stepInFlight = false;
      },
    });
    post({
      type: 'batch',
      requestId,
      commands,
      step: { dt, forceStep: opts.forceStep === true },
    });
    return {
      simTime,
      steps: 0,
      poses,
      skipped: dynamicCount === 0 && opts.forceStep !== true,
      deferred: true,
    };
  }

  const proxy = {
    kind: 'worker',
    fixedDt,
    maxSubSteps,
    _shadows: shadows,
    _enqueue: enqueue,
    _queuePose: queuePose,
    _recomputeDynamicCount: recomputeDynamicCount,
    worker,
    whenReady,

    /** True when poses flow through SharedArrayBuffer. */
    get sharedPoses() { return sharedEnabled && !!sharedBundle; },

    get simTime() { return simTime; },
    get bodyCount() { return bodyCount || shadows.size; },
    get dynamicCount() { return dynamicCount; },
    get accumulator() { return 0; },

    setGravity(x, y, z) {
      if (Array.isArray(x)) {
        gravity[0] = x[0]; gravity[1] = x[1]; gravity[2] = x[2];
        enqueue({ op: 'setGravity', x: x[0], y: x[1], z: x[2] });
        return;
      }
      gravity[0] = x; gravity[1] = y; gravity[2] = z;
      enqueue({ op: 'setGravity', x, y, z });
    },

    getGravity() {
      return [gravity[0], gravity[1], gravity[2]];
    },

    /**
     * Synchronous addBody: allocate bodyId on main, shadow a handle immediately,
     * and queue creation on the worker (flushed with the next step / when ready).
     * @returns {number} bodyId
     */
    addBody(desc = {}) {
      if (disposed) throw new Error('PhysicsBackend disposed');
      const bodyId = desc.id != null && Number(desc.id) > 0 ? Number(desc.id) : allocBodyId();
      if (bodyId >= nextBodyId) nextBodyId = bodyId + 1;
      if (shadows.has(bodyId)) {
        throw new Error(`PhysicsBackend: body id ${bodyId} already registered`);
      }

      const type = resolveType(desc);
      const mass = desc.mass != null
        ? Number(desc.mass)
        : (type === BODY_TYPE.STATIC ? 0 : 1);
      const position = desc.position ? [...desc.position] : [0, 0, 0];
      const slot = nextSlot;
      nextSlot += 1;
      slots.set(bodyId, slot);
      ensurePoseCapacity(nextSlot);
      ensureSharedCapacity(nextSlot);
      writePose(poses, slot, { px: position[0], py: position[1], pz: position[2] });

      shadows.set(bodyId, {
        type,
        mass,
        collisionResponse: desc.collisionResponse !== false,
        position,
        velocity: [0, 0, 0],
        angularVelocity: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        euler: null,
        handle: null,
      });
      const state = shadows.get(bodyId);
      state.handle = createShadowHandle(proxy, bodyId);
      bodyCount = shadows.size;
      recomputeDynamicCount();

      // Queue creation for the next batch — never race a free-standing addBody
      // against step(), or the worker may step before the body exists.
      const fullDesc = { ...desc, id: bodyId, type, mass, position };
      pendingAdds.set(bodyId, fullDesc);
      return bodyId;
    },

    async addBodyAsync(desc = {}) {
      if (disposed) throw new Error('PhysicsBackend disposed');
      await whenReady();
      if (initFailed) throw initFailed;
      const bodyId = this.addBody(desc);
      const fullDesc = pendingAdds.get(bodyId);
      if (fullDesc) {
        pendingAdds.delete(bodyId);
        const response = await request({ type: 'addBody', desc: fullDesc });
        if (response.slot != null) {
          slots.set(bodyId, response.slot);
          if (response.slot >= nextSlot) nextSlot = response.slot + 1;
        }
      }
      return bodyId;
    },

    removeBody(bodyId) {
      if (!shadows.has(bodyId)) return false;
      shadows.delete(bodyId);
      // Keep slot index stable (match main backend) so pose buffers stay aligned.
      // slots map retains bodyId→slot until dispose; hole is fine.
      bodyCount = shadows.size;
      recomputeDynamicCount();
      if (pendingAdds.has(bodyId)) {
        pendingAdds.delete(bodyId);
        return true;
      }
      enqueue({ op: 'removeBody', bodyId });
      return true;
    },

    getHandle(bodyId) {
      return shadows.get(bodyId)?.handle || null;
    },

    getSlot(bodyId) {
      return slots.has(bodyId) ? slots.get(bodyId) : -1;
    },

    command(bodyId, op, payload = {}) {
      if (!shadows.has(bodyId) && op !== 'setGravity') return false;
      enqueue({ op, bodyId, payload });
      if (op === 'setType' || op === 'setMass') {
        const state = shadows.get(bodyId);
        if (state) {
          if (op === 'setType') state.type = payload.type;
          if (op === 'setMass') state.mass = Number(payload.mass) || 0;
          recomputeDynamicCount();
        }
      }
      return true;
    },

    step(dt, opts = {}) {
      // onPreStep cannot run inside the worker (closures over main meshes).
      // Call it on main before enqueueing the remote step.
      if (opts.onPreStep) {
        // Advance a local fixed clock mirror for pre-step consumers that only
        // need the tick signal (collision integrator). Remote simTime catches up.
        const frameDt = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
        let acc = frameDt;
        let guard = 0;
        while (acc >= fixedDt && guard < maxSubSteps) {
          opts.onPreStep(fixedDt, simTime);
          acc -= fixedDt;
          guard += 1;
        }
      }
      // Opportunistic pull of any SAB frame completed since last read.
      if (sharedEnabled) pullSharedPoses();
      return flushStep(dt, opts);
    },

    /** Await one complete worker step (tests / explicit sync points). */
    async stepAsync(dt, opts = {}) {
      await whenReady();
      if (initFailed) throw initFailed;
      if (opts.onPreStep) {
        opts.onPreStep(fixedDt, simTime);
      }
      const commands = [
        ...drainPendingAddCommands(),
        ...pendingCommands.splice(0, pendingCommands.length),
      ];
      const data = await request({
        type: 'batch',
        commands,
        step: { dt, forceStep: opts.forceStep === true },
      });
      if (data.sab && sharedBundle) {
        pullSharedPoses({ ...data, force: true });
      } else {
        applyPosesBuffer(data.buffer, data);
      }
      stepInFlight = false;
      return {
        simTime,
        steps: data.steps || 0,
        poses,
        skipped: !!data.skipped,
        sab: !!data.sab,
      };
    },

    syncMeshes(meshes) {
      // Prefer freshest SAB snapshot just before mesh write.
      if (sharedEnabled) pullSharedPoses();
      for (const mesh of meshes) {
        const bodyId = mesh.userData?.bodyId ?? mesh.userData?.body?.id;
        if (bodyId == null) continue;
        const slot = slots.get(bodyId);
        if (slot == null) continue;
        const o = slot * POSE_STRIDE;
        if (o + 7 >= poses.length) continue;
        mesh.position.set(poses[o], poses[o + 1], poses[o + 2]);
        mesh.quaternion.set(poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]);
      }
    },

    resetClock() {
      simTime = 0;
      post({ type: 'resetClock' });
    },

    getPose(bodyId) {
      const slot = slots.get(bodyId);
      if (slot == null) return null;
      const o = slot * POSE_STRIDE;
      return poses.slice(o, o + POSE_STRIDE);
    },

    dispose() {
      if (disposed) return false;
      disposed = true;
      try { post({ type: 'dispose', requestId: allocRequestId() }); } catch { /* ignore */ }
      try {
        worker.removeEventListener?.('message', onMessage);
        if (worker.onmessage === onMessage) worker.onmessage = null;
      } catch { /* ignore */ }
      try { worker.terminate?.(); } catch { /* ignore */ }
      shadows.clear();
      slots.clear();
      pendingCommands.length = 0;
      poses = new Float32Array(0);
      sharedBundle = null;
      sharedEnabled = false;
      return true;
    },
  };

  return proxy;
}
