/**
 * Main-thread PhysicsBackend backed by cannon-es.
 *
 * Experiments talk to BodyHandle (Cannon-like surface) or command()/getPose().
 * A future physics.worker.js will implement the same contract over postMessage.
 */

import * as CANNON from 'cannon-es';
import {
  BODY_TYPE,
  DEFAULT_FIXED_DT,
  DEFAULT_MAX_SUBSTEPS,
  POSE_STRIDE,
  writePose,
} from './types.js';

let nextBodyId = 1;

function allocId() {
  const id = nextBodyId;
  nextBodyId += 1;
  return id;
}

function makeVec3Proxy(read, write) {
  return {
    get x() { return read().x; },
    get y() { return read().y; },
    get z() { return read().z; },
    set x(v) { const c = read(); write(v, c.y, c.z); },
    set y(v) { const c = read(); write(c.x, v, c.z); },
    set z(v) { const c = read(); write(c.x, c.y, v); },
    set(x = 0, y = 0, z = 0) { write(x, y, z); return this; },
    setZero() { write(0, 0, 0); return this; },
    copy(other) {
      write(
        Number(other?.x) || 0,
        Number(other?.y) || 0,
        Number(other?.z) || 0,
      );
      return this;
    },
  };
}

function makeQuatProxy(getBody) {
  return {
    get x() { return getBody().quaternion.x; },
    get y() { return getBody().quaternion.y; },
    get z() { return getBody().quaternion.z; },
    get w() { return getBody().quaternion.w; },
    set(x, y, z, w) {
      getBody().quaternion.set(x, y, z, w);
      return this;
    },
    setFromEuler(x = 0, y = 0, z = 0, order = 'XYZ') {
      getBody().quaternion.setFromEuler(x, y, z, order);
      return this;
    },
    copy(other) {
      getBody().quaternion.set(
        Number(other?.x) || 0,
        Number(other?.y) || 0,
        Number(other?.z) || 0,
        Number(other?.w) || 1,
      );
      return this;
    },
  };
}

/**
 * Cannon-shaped handle so free-fall / projectile / inclined-plane keep working
 * while the authoritative state lives in the backend registry.
 */
export function createBodyHandle(backend, bodyId) {
  const getEntry = () => {
    const entry = backend._entries.get(bodyId);
    if (!entry) throw new Error(`PhysicsBackend: unknown body ${bodyId}`);
    return entry;
  };
  const getBody = () => getEntry().body;

  return {
    id: bodyId,
    /** @deprecated internal — prefer backend APIs; kept for transitional code */
    get _cannon() { return getBody(); },

    get type() { return getBody().type; },
    set type(value) {
      getBody().type = value;
      backend._recomputeDynamicCount?.();
    },

    get mass() { return getBody().mass; },
    set mass(value) {
      getBody().mass = value;
      getBody().updateMassProperties();
      backend._recomputeDynamicCount?.();
    },

    get collisionResponse() { return getBody().collisionResponse; },
    set collisionResponse(value) { getBody().collisionResponse = !!value; },

    position: makeVec3Proxy(
      () => getBody().position,
      (x, y, z) => getBody().position.set(x, y, z),
    ),
    velocity: makeVec3Proxy(
      () => getBody().velocity,
      (x, y, z) => getBody().velocity.set(x, y, z),
    ),
    angularVelocity: makeVec3Proxy(
      () => getBody().angularVelocity,
      (x, y, z) => getBody().angularVelocity.set(x, y, z),
    ),
    quaternion: makeQuatProxy(getBody),

    wakeUp() { getBody().wakeUp(); },
    sleep() { getBody().sleep(); },
    updateMassProperties() { getBody().updateMassProperties(); },
  };
}

function buildShape(desc = {}) {
  const kind = desc.shape || desc.kind || 'sphere';
  if (kind === 'sphere') {
    return new CANNON.Sphere(Number(desc.radius) || 0.3);
  }
  if (kind === 'box') {
    let sx = 1;
    let sy = 1;
    let sz = 1;
    if (desc.halfExtents) {
      sx = desc.halfExtents[0] * 2;
      sy = desc.halfExtents[1] * 2;
      sz = desc.halfExtents[2] * 2;
    } else if (desc.size) {
      [sx, sy, sz] = desc.size;
    }
    return new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2));
  }
  if (kind === 'plane') {
    return new CANNON.Plane();
  }
  throw new TypeError(`PhysicsBackend: unsupported shape "${kind}"`);
}

function resolveType(desc = {}) {
  if (desc.type != null) return desc.type;
  if (desc.mass === 0 || desc.static) return BODY_TYPE.STATIC;
  return BODY_TYPE.DYNAMIC;
}

/**
 * @param {{
 *   fixedDt?: number,
 *   maxSubSteps?: number,
 *   gravity?: [number, number, number],
 *   friction?: number,
 *   restitution?: number,
 * }} [options]
 */
export function createMainPhysicsBackend({
  fixedDt = DEFAULT_FIXED_DT,
  maxSubSteps = DEFAULT_MAX_SUBSTEPS,
  gravity = [0, -9.81, 0],
  friction = 0.35,
  restitution = 0.2,
} = {}) {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(gravity[0], gravity[1], gravity[2]),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = friction;
  world.defaultContactMaterial.restitution = restitution;

  /** @type {Map<number, { id: number, body: import('cannon-es').Body, slot: number, handle: object }>} */
  const entries = new Map();
  /** slot → bodyId for dense pose packing */
  const slotToId = [];
  let poses = new Float32Array(0);
  let simTime = 0;
  let accumulator = 0;
  let disposed = false;
  let dynamicCount = 0;

  function recomputeDynamicCount() {
    dynamicCount = 0;
    for (const entry of entries.values()) {
      if (entry.body.type === BODY_TYPE.DYNAMIC && entry.body.mass > 0) dynamicCount += 1;
    }
  }

  function ensurePoseCapacity() {
    const need = slotToId.length * POSE_STRIDE;
    if (poses.length < need) {
      const next = new Float32Array(Math.max(need, poses.length ? poses.length * 2 : POSE_STRIDE * 4));
      next.set(poses);
      poses = next;
    }
  }

  function capturePoses() {
    ensurePoseCapacity();
    for (const entry of entries.values()) {
      const { body, slot } = entry;
      writePose(poses, slot, {
        px: body.position.x,
        py: body.position.y,
        pz: body.position.z,
        qx: body.quaternion.x,
        qy: body.quaternion.y,
        qz: body.quaternion.z,
        qw: body.quaternion.w,
        vx: body.velocity.x,
        vy: body.velocity.y,
        vz: body.velocity.z,
      });
    }
    return poses.subarray(0, slotToId.length * POSE_STRIDE);
  }

  const backend = {
    kind: 'main',
    fixedDt,
    maxSubSteps,
    /** @internal */
    _entries: entries,
    /** @internal raw world for transitional shims only */
    _world: world,
    /** @internal */
    _recomputeDynamicCount: recomputeDynamicCount,

    get simTime() { return simTime; },
    get bodyCount() { return entries.size; },
    get dynamicCount() { return dynamicCount; },
    get accumulator() { return accumulator; },

    setGravity(x, y, z) {
      if (Array.isArray(x)) {
        world.gravity.set(x[0], x[1], x[2]);
        return;
      }
      world.gravity.set(x, y, z);
    },

    getGravity() {
      return [world.gravity.x, world.gravity.y, world.gravity.z];
    },

    /**
     * @param {{
     *   shape: 'sphere'|'box'|'plane',
     *   radius?: number,
     *   size?: [number, number, number],
     *   position?: [number, number, number],
     *   rotation?: [number, number, number],
     *   mass?: number,
     *   type?: number,
     *   friction?: number,
     *   restitution?: number,
     *   linearDamping?: number,
     *   angularDamping?: number,
     *   collisionResponse?: boolean,
     * }} desc
     * @returns {number} bodyId
     */
    addBody(desc = {}) {
      if (disposed) throw new Error('PhysicsBackend disposed');
      // Prefer caller-supplied id so the worker proxy can allocate on main and
      // keep BodyHandle ids stable without a round-trip.
      const requested = desc.id != null ? Number(desc.id) : 0;
      const id = requested > 0 ? requested : allocId();
      if (requested > 0 && entries.has(id)) {
        throw new Error(`PhysicsBackend: body id ${id} already registered`);
      }
      if (id >= nextBodyId) nextBodyId = id + 1;
      const position = desc.position || [0, 0, 0];
      const type = resolveType(desc);
      const mass = desc.mass != null
        ? Number(desc.mass)
        : (type === BODY_TYPE.STATIC ? 0 : 1);
      const body = new CANNON.Body({
        mass: type === BODY_TYPE.STATIC ? 0 : mass,
        type,
        shape: buildShape(desc),
        position: new CANNON.Vec3(position[0], position[1], position[2]),
        linearDamping: desc.linearDamping != null ? desc.linearDamping : 0.01,
        angularDamping: desc.angularDamping != null ? desc.angularDamping : 0.05,
        material: new CANNON.Material({
          friction: desc.friction != null ? desc.friction : 0.3,
          restitution: desc.restitution != null ? desc.restitution : 0.2,
        }),
      });
      if (desc.rotation) body.quaternion.setFromEuler(...desc.rotation);
      if (desc.collisionResponse === false) body.collisionResponse = false;
      // Plane ground convention used by labkit: rotate -PI/2 about X.
      if ((desc.shape || desc.kind) === 'plane' && !desc.rotation) {
        body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      }

      world.addBody(body);
      const slot = slotToId.length;
      slotToId.push(id);
      const entry = { id, body, slot, handle: null };
      entries.set(id, entry);
      entry.handle = createBodyHandle(backend, id);
      recomputeDynamicCount();
      ensurePoseCapacity();
      capturePoses();
      return id;
    },

    /** Register an already-built Cannon body (legacy LabEngine / transitional). */
    adoptBody(cannonBody) {
      if (disposed) throw new Error('PhysicsBackend disposed');
      const id = allocId();
      if (!cannonBody.world) world.addBody(cannonBody);
      const slot = slotToId.length;
      slotToId.push(id);
      const entry = { id, body: cannonBody, slot, handle: null };
      entries.set(id, entry);
      entry.handle = createBodyHandle(backend, id);
      recomputeDynamicCount();
      ensurePoseCapacity();
      capturePoses();
      return id;
    },

    removeBody(bodyId) {
      const entry = entries.get(bodyId);
      if (!entry) return false;
      world.removeBody(entry.body);
      entries.delete(bodyId);
      // Keep slot indices stable for the worker pose protocol (no compact/renumber).
      // Holes are fine — body counts stay tiny (0–5).
      slotToId[entry.slot] = 0;
      recomputeDynamicCount();
      capturePoses();
      return true;
    },

    getHandle(bodyId) {
      return entries.get(bodyId)?.handle || null;
    },

    getSlot(bodyId) {
      const entry = entries.get(bodyId);
      return entry ? entry.slot : -1;
    },

    /**
     * Imperative command surface used by worker protocol later.
     * @param {number} bodyId
     * @param {string} op
     * @param {object} [payload]
     */
    command(bodyId, op, payload = {}) {
      const entry = entries.get(bodyId);
      if (!entry) return false;
      const { body } = entry;
      switch (op) {
        case 'setType':
          body.type = payload.type;
          recomputeDynamicCount();
          break;
        case 'setMass':
          body.mass = Number(payload.mass) || 0;
          body.updateMassProperties();
          recomputeDynamicCount();
          break;
        case 'setPose':
          if (payload.position) body.position.set(...payload.position);
          if (payload.quaternion) body.quaternion.set(...payload.quaternion);
          if (payload.euler) body.quaternion.setFromEuler(...payload.euler);
          break;
        case 'setVelocity':
          if (payload.velocity) body.velocity.set(...payload.velocity);
          if (payload.angularVelocity) body.angularVelocity.set(...payload.angularVelocity);
          break;
        case 'wake':
          body.wakeUp();
          break;
        case 'sleep':
          body.sleep();
          break;
        case 'setCollisionResponse':
          body.collisionResponse = !!payload.value;
          break;
        default:
          return false;
      }
      return true;
    },

    /**
     * Fixed-step integration.
     * @param {number} dt frame contribution (seconds)
     * @param {{ onPreStep?: (fixedDt: number, simTime: number) => void, forceStep?: boolean }} [opts]
     * @returns {{ simTime: number, steps: number, poses: Float32Array, skipped: boolean }}
     */
    step(dt, opts = {}) {
      if (disposed) {
        return { simTime, steps: 0, poses: capturePoses(), skipped: true };
      }
      const frameDt = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
      accumulator += frameDt;
      const onPreStep = opts.onPreStep;
      // Skip cannon solve when nothing dynamic is active, unless a pre-step
      // integrator (e.g. collision) still needs the fixed clock, or forced.
      const needsSolve = opts.forceStep === true || dynamicCount > 0 || !!onPreStep;
      let steps = 0;
      while (accumulator >= fixedDt && steps < maxSubSteps) {
        onPreStep?.(fixedDt, simTime);
        // Only run the broadphase/solver when there is something to integrate.
        // onPreStep alone (formula labs) still advances simTime without world.step.
        if (dynamicCount > 0 || opts.forceStep === true) world.step(fixedDt);
        simTime += fixedDt;
        accumulator -= fixedDt;
        steps += 1;
      }
      if (accumulator > fixedDt * 2) accumulator = 0;
      recomputeDynamicCount();
      return {
        simTime,
        steps,
        poses: capturePoses(),
        skipped: dynamicCount === 0 && opts.forceStep !== true,
      };
    },

    /** Apply last poses onto meshes that carry userData.bodyId or userData.body. */
    syncMeshes(meshes) {
      const view = capturePoses();
      for (const mesh of meshes) {
        const bodyId = mesh.userData?.bodyId;
        const handle = mesh.userData?.body;
        const id = bodyId != null ? bodyId : handle?.id;
        if (id == null) continue;
        const entry = entries.get(id);
        if (!entry) continue;
        const o = entry.slot * POSE_STRIDE;
        mesh.position.set(view[o], view[o + 1], view[o + 2]);
        mesh.quaternion.set(view[o + 3], view[o + 4], view[o + 5], view[o + 6]);
      }
    },

    resetClock() {
      simTime = 0;
      accumulator = 0;
    },

    /** Snapshot pose for one body (10 floats) or null. */
    getPose(bodyId) {
      const entry = entries.get(bodyId);
      if (!entry) return null;
      const view = capturePoses();
      const o = entry.slot * POSE_STRIDE;
      return view.slice(o, o + POSE_STRIDE);
    },

    dispose() {
      if (disposed) return false;
      disposed = true;
      for (const entry of [...entries.values()]) {
        world.removeBody(entry.body);
      }
      entries.clear();
      slotToId.length = 0;
      poses = new Float32Array(0);
      dynamicCount = 0;
      accumulator = 0;
      simTime = 0;
      return true;
    },
  };

  return backend;
}
