import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_TYPE,
  POSE_STRIDE,
  createPhysicsBackend,
  createSharedPoseBuffer,
  createWorkerPhysicsBackend,
  publishSharedPoses,
  readSharedPoses,
  resolvePhysicsMode,
  shouldUseSharedPoses,
  readPose,
  writePose,
  SAB_I32,
  SAB_PROTOCOL_VERSION,
} from '../src/runtime/threading/physicsBackend.js';
import { handleMessage as handlePhysicsWorkerMessage } from '../src/runtime/threading/physics.worker.js';

/**
 * In-process Worker stand-in: routes postMessage through physics.worker handleMessage.
 * Covers the proxy protocol without a real Worker thread (Node test runner).
 */
function createMockPhysicsWorker() {
  const listeners = new Set();
  const worker = {
    onmessage: null,
    postMessage(message) {
      queueMicrotask(() => {
        const response = handlePhysicsWorkerMessage(message);
        if (!response) return;
        // Mirror transfer protocol: drop transfer list, keep buffer as Float32Array.
        delete response.transfer;
        const event = { data: response };
        worker.onmessage?.(event);
        for (const fn of listeners) fn(event);
      });
    },
    addEventListener(type, fn) {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'message') listeners.delete(fn);
    },
    terminate() {
      listeners.clear();
      worker.onmessage = null;
    },
  };
  return worker;
}

test('pose layout stride is 10 floats', () => {
  assert.equal(POSE_STRIDE, 10);
  const buf = new Float32Array(POSE_STRIDE * 2);
  writePose(buf, 1, { px: 1, py: 2, pz: 3, qx: 0, qy: 0, qz: 0, qw: 1, vx: 4, vy: 5, vz: 6 });
  const pose = readPose(buf, 1);
  assert.equal(pose.px, 1);
  assert.equal(pose.py, 2);
  assert.equal(pose.pz, 3);
  assert.equal(pose.vx, 4);
  assert.equal(pose.vy, 5);
  assert.equal(pose.vz, 6);
  assert.equal(pose.qw, 1);
});

test('main backend adds bodies and packs poses', () => {
  const backend = createPhysicsBackend({ mode: 'main', gravity: [0, -9.81, 0] });
  const floorId = backend.addBody({ shape: 'plane', type: BODY_TYPE.STATIC, mass: 0 });
  const ballId = backend.addBody({
    shape: 'sphere',
    radius: 0.25,
    position: [0, 5, 0],
    mass: 1,
    type: BODY_TYPE.DYNAMIC,
  });
  assert.equal(backend.bodyCount, 2);
  assert.equal(backend.dynamicCount, 1);
  assert.notEqual(floorId, ballId);

  const handle = backend.getHandle(ballId);
  assert.ok(handle);
  assert.equal(handle.position.y, 5);

  const pose = backend.getPose(ballId);
  assert.equal(pose.length, POSE_STRIDE);
  assert.equal(pose[1], 5); // py
  backend.dispose();
});

test('main backend steps dynamic sphere under gravity', () => {
  const backend = createPhysicsBackend({ mode: 'main', gravity: [0, -10, 0], fixedDt: 1 / 60, maxSubSteps: 4 });
  backend.addBody({ shape: 'plane', type: BODY_TYPE.STATIC, mass: 0 });
  const ballId = backend.addBody({
    shape: 'sphere',
    radius: 0.2,
    position: [0, 4, 0],
    mass: 1,
    type: BODY_TYPE.DYNAMIC,
    restitution: 0,
    friction: 0,
  });

  // ~0.5 s of simulation
  for (let i = 0; i < 30; i += 1) {
    backend.step(1 / 60);
  }
  const pose = backend.getPose(ballId);
  // y should have dropped from 4 m under g=10
  assert.ok(pose[1] < 3.5, `expected y < 3.5, got ${pose[1]}`);
  assert.ok(pose[8] < 0, `expected negative vy, got ${pose[8]}`);
  assert.ok(backend.simTime > 0.4);
  backend.dispose();
});

test('main backend skips world.step when only static/kinematic bodies', () => {
  const backend = createPhysicsBackend({ mode: 'main' });
  backend.addBody({ shape: 'plane', type: BODY_TYPE.STATIC, mass: 0 });
  const id = backend.addBody({
    shape: 'sphere',
    radius: 0.2,
    position: [0, 2, 0],
    mass: 1,
    type: BODY_TYPE.KINEMATIC,
  });
  assert.equal(backend.dynamicCount, 0);

  const before = backend.getPose(id)[1];
  const result = backend.step(1 / 30);
  assert.equal(result.skipped, true);
  assert.ok(result.steps >= 1, 'clock still advances');
  // Kinematic without external write should stay put
  assert.equal(backend.getPose(id)[1], before);
  backend.dispose();
});

test('BodyHandle command surface and type flip updates dynamicCount', () => {
  const backend = createPhysicsBackend({ mode: 'main' });
  const id = backend.addBody({
    shape: 'sphere',
    radius: 0.3,
    position: [0, 1, 0],
    mass: 2,
    type: BODY_TYPE.KINEMATIC,
  });
  assert.equal(backend.dynamicCount, 0);
  const body = backend.getHandle(id);
  body.type = BODY_TYPE.DYNAMIC;
  body.mass = 2;
  body.velocity.set(1, 0, 0);
  body.wakeUp();
  assert.equal(backend.dynamicCount, 1);

  backend.command(id, 'setType', { type: BODY_TYPE.KINEMATIC });
  assert.equal(backend.dynamicCount, 0);
  backend.command(id, 'setPose', { position: [3, 4, 5] });
  assert.equal(body.position.x, 3);
  assert.equal(body.position.y, 4);
  assert.equal(body.position.z, 5);
  backend.dispose();
});

test('dispose clears bodies and rejects further addBody', () => {
  const backend = createPhysicsBackend({ mode: 'main' });
  backend.addBody({ shape: 'sphere', radius: 0.1, position: [0, 0, 0], mass: 1 });
  assert.equal(backend.dispose(), true);
  assert.equal(backend.bodyCount, 0);
  assert.throws(() => backend.addBody({ shape: 'sphere', radius: 0.1, mass: 1 }));
});

test('syncMeshes copies pose onto mesh userData.bodyId', () => {
  const backend = createPhysicsBackend({ mode: 'main', gravity: [0, 0, 0] });
  const id = backend.addBody({
    shape: 'box',
    size: [1, 1, 1],
    position: [2, 3, 4],
    mass: 0,
    type: BODY_TYPE.STATIC,
  });
  const mesh = {
    userData: { bodyId: id },
    position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    quaternion: { set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; } },
  };
  backend.syncMeshes([mesh]);
  assert.equal(mesh.position.x, 2);
  assert.equal(mesh.position.y, 3);
  assert.equal(mesh.position.z, 4);
  backend.dispose();
});

test('resolvePhysicsMode defaults to auto and accepts worker/main', () => {
  assert.equal(resolvePhysicsMode({}), 'auto');
  assert.equal(resolvePhysicsMode({ mode: 'worker' }), 'worker');
  assert.equal(resolvePhysicsMode({ mode: 'main' }), 'main');
  assert.equal(resolvePhysicsMode({ mode: 'auto' }), 'auto');
  assert.equal(resolvePhysicsMode({ mode: 'nope' }), 'auto');
});

test('createPhysicsBackend without mode uses auto and falls back to main in Node', () => {
  const backend = createPhysicsBackend({
    WorkerCtor: null,
    onFallback: () => {},
  });
  // Node has no Worker → auto falls back to main.
  assert.equal(backend.kind, 'main');
  backend.dispose();
});

test('createPhysicsBackend worker mode falls back when Worker is unavailable', () => {
  let fellBack = false;
  const backend = createPhysicsBackend({
    mode: 'worker',
    WorkerCtor: null,
    worker: null,
    onFallback: () => { fellBack = true; },
  });
  assert.equal(backend.kind, 'main');
  assert.equal(fellBack, true);
  backend.dispose();
});

test('physics worker handleMessage init/add/step protocol', () => {
  const ready = handlePhysicsWorkerMessage({ type: 'init', options: { gravity: [0, -10, 0], fixedDt: 1 / 60 } });
  assert.equal(ready.type, 'ready');

  const added = handlePhysicsWorkerMessage({
    type: 'addBody',
    requestId: 1,
    desc: {
      id: 42,
      shape: 'sphere',
      radius: 0.2,
      position: [0, 5, 0],
      mass: 1,
      type: BODY_TYPE.DYNAMIC,
    },
  });
  assert.equal(added.type, 'added');
  assert.equal(added.bodyId, 42);
  assert.equal(added.slot, 0);

  const poses = handlePhysicsWorkerMessage({
    type: 'batch',
    requestId: 2,
    commands: [],
    step: { dt: 1 / 30 },
  });
  assert.equal(poses.type, 'poses');
  assert.ok(poses.steps >= 1);
  assert.ok(poses.buffer instanceof Float32Array);
  assert.ok(poses.buffer[1] < 5, `y should drop under gravity, got ${poses.buffer[1]}`);

  handlePhysicsWorkerMessage({ type: 'dispose', requestId: 3 });
});

test('worker proxy addBody is sync and stepAsync advances poses', async () => {
  const mock = createMockPhysicsWorker();
  const backend = createWorkerPhysicsBackend({
    worker: mock,
    gravity: [0, -10, 0],
    fixedDt: 1 / 60,
    maxSubSteps: 4,
  });

  await backend.whenReady();
  assert.equal(backend.kind, 'worker');

  const floorId = backend.addBody({ shape: 'plane', type: BODY_TYPE.STATIC, mass: 0 });
  const ballId = backend.addBody({
    shape: 'sphere',
    radius: 0.2,
    position: [0, 4, 0],
    mass: 1,
    type: BODY_TYPE.DYNAMIC,
  });
  assert.ok(floorId > 0);
  assert.ok(ballId > floorId);
  assert.equal(backend.dynamicCount, 1);

  const handle = backend.getHandle(ballId);
  assert.equal(handle.position.y, 4);

  // Non-blocking step returns last poses immediately (may be deferred).
  const deferred = backend.step(1 / 60);
  assert.equal(typeof deferred.simTime, 'number');

  // Await a full step cycle through the mock worker.
  for (let i = 0; i < 20; i += 1) {
    await backend.stepAsync(1 / 60);
  }
  const pose = backend.getPose(ballId);
  assert.ok(pose, 'pose available after stepAsync');
  assert.ok(pose[1] < 3.5, `expected y < 3.5 after fall, got ${pose[1]}`);
  assert.ok(backend.simTime > 0.2);

  backend.dispose();
});

test('worker proxy BodyHandle mutates queue commands applied on stepAsync', async () => {
  const mock = createMockPhysicsWorker();
  const backend = createWorkerPhysicsBackend({
    worker: mock,
    gravity: [0, 0, 0],
    fixedDt: 1 / 60,
  });
  await backend.whenReady();

  const id = backend.addBody({
    shape: 'sphere',
    radius: 0.3,
    position: [0, 1, 0],
    mass: 1,
    type: BODY_TYPE.KINEMATIC,
  });
  const body = backend.getHandle(id);
  body.position.set(2, 3, 4);
  body.type = BODY_TYPE.DYNAMIC;
  body.mass = 2;
  assert.equal(backend.dynamicCount, 1);

  await backend.stepAsync(1 / 60);
  // After worker applies setPose from shadow, pose should reflect position.
  // (gravity is zero so it stays)
  const pose = backend.getPose(id);
  assert.ok(pose);
  // Position was queued; after step the worker state should match.
  assert.ok(
    Math.abs(pose[0] - 2) < 0.01 && Math.abs(pose[1] - 3) < 0.01 && Math.abs(pose[2] - 4) < 0.01,
    `expected pose near (2,3,4), got (${pose[0]},${pose[1]},${pose[2]})`,
  );

  backend.dispose();
});

test('shared pose buffer publish/read is generation-consistent', () => {
  assert.equal(SAB_PROTOCOL_VERSION, 1);
  const bundle = createSharedPoseBuffer(4);
  assert.equal(Atomics.load(bundle.i32, SAB_I32.CAPACITY_SLOTS), 4);
  assert.equal(Atomics.load(bundle.i32, SAB_I32.VERSION), SAB_PROTOCOL_VERSION);

  const poses = new Float32Array(POSE_STRIDE * 2);
  writePose(poses, 0, { px: 1, py: 2, pz: 3, vx: 0.5 });
  writePose(poses, 1, { px: 4, py: 5, pz: 6, vy: -1 });

  const gen = publishSharedPoses(bundle, {
    simTime: 1.25,
    steps: 2,
    skipped: false,
    bodyCount: 2,
    dynamicCount: 1,
    poses,
  });
  assert.equal(gen % 2, 0, 'complete generation is even');

  const frame = readSharedPoses(bundle);
  assert.ok(frame);
  assert.equal(frame.ok, true);
  assert.equal(frame.generation, gen);
  assert.equal(frame.simTime, 1.25);
  assert.equal(frame.steps, 2);
  assert.equal(frame.bodyCount, 2);
  assert.equal(frame.poses[0], 1);
  assert.equal(frame.poses[1], 2);
  assert.equal(frame.poses[POSE_STRIDE], 4);
  assert.equal(frame.poses[POSE_STRIDE + 1], 5);
});

test('shared pose read returns null while writer holds odd generation', () => {
  const bundle = createSharedPoseBuffer(2);
  Atomics.store(bundle.i32, SAB_I32.GENERATION, 3); // odd = writing
  assert.equal(readSharedPoses(bundle), null);
  Atomics.store(bundle.i32, SAB_I32.GENERATION, 4);
  // empty but complete frame is readable
  const frame = readSharedPoses(bundle);
  assert.ok(frame);
  assert.equal(frame.generation, 4);
});

test('shouldUseSharedPoses is true in Node test environment', () => {
  assert.equal(shouldUseSharedPoses(), true);
  assert.equal(shouldUseSharedPoses({ force: true }), true);
});

test('worker proxy uses SAB path when SharedArrayBuffer is available', async () => {
  const mock = createMockPhysicsWorker();
  const backend = createWorkerPhysicsBackend({
    worker: mock,
    gravity: [0, -10, 0],
    fixedDt: 1 / 60,
    forceSharedBuffer: true,
  });
  await backend.whenReady();
  assert.equal(backend.sharedPoses, true, 'init should attach SAB');

  backend.addBody({ shape: 'plane', type: BODY_TYPE.STATIC, mass: 0 });
  const ballId = backend.addBody({
    shape: 'sphere',
    radius: 0.2,
    position: [0, 4, 0],
    mass: 1,
    type: BODY_TYPE.DYNAMIC,
  });

  let sawSab = false;
  for (let i = 0; i < 30; i += 1) {
    const result = await backend.stepAsync(1 / 60);
    if (result.sab) sawSab = true;
  }
  assert.equal(sawSab, true, 'at least one step should publish via SAB');
  assert.equal(backend.sharedPoses, true);
  const pose = backend.getPose(ballId);
  assert.ok(pose);
  // ~0.5 s under g=10 from y=4 ⇒ y ≈ 4 - 1.25 = 2.75 (before floor contact).
  assert.ok(pose[1] < 3.5, `expected fall via SAB poses, y=${pose[1]}`);
  assert.ok(pose[8] < 0, `expected negative vy via SAB, got ${pose[8]}`);
  backend.dispose();
});

test('worker handleMessage SAB init publishes without transferable buffer', () => {
  const bundle = createSharedPoseBuffer(4);
  const ready = handlePhysicsWorkerMessage({
    type: 'init',
    options: { gravity: [0, -10, 0], fixedDt: 1 / 60 },
    sharedBuffer: bundle.sab,
    capacitySlots: bundle.capacitySlots,
  });
  assert.equal(ready.type, 'ready');
  assert.equal(ready.shared, true);

  handlePhysicsWorkerMessage({
    type: 'addBody',
    requestId: 1,
    desc: {
      id: 7,
      shape: 'sphere',
      radius: 0.2,
      position: [0, 3, 0],
      mass: 1,
      type: BODY_TYPE.DYNAMIC,
    },
  });

  const posesMsg = handlePhysicsWorkerMessage({
    type: 'step',
    requestId: 2,
    dt: 1 / 30,
  });
  assert.equal(posesMsg.type, 'poses');
  assert.equal(posesMsg.sab, true);
  assert.equal(posesMsg.buffer, undefined);

  const frame = readSharedPoses(bundle);
  assert.ok(frame);
  assert.ok(frame.simTime > 0);
  assert.ok(frame.poses[1] < 3, `y should drop, got ${frame.poses[1]}`);

  handlePhysicsWorkerMessage({ type: 'dispose', requestId: 3 });
});

test('worker physics backend removes message listener on dispose', () => {
  const listeners = new Set();
  const worker = {
    onmessage: null,
    postMessage() {},
    addEventListener(type, fn) {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'message') listeners.delete(fn);
    },
    terminate() {},
  };

  const backend = createWorkerPhysicsBackend({ worker });
  assert.ok(listeners.size >= 1 || typeof worker.onmessage === 'function', 'listener registered');
  backend.dispose();
  assert.equal(listeners.size, 0, 'listeners set must be empty after dispose');
  assert.equal(worker.onmessage, null, 'onmessage must be null after dispose');
});

