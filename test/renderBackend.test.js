import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseOffscreenCanvas,
  createMainRenderBackend,
  createRenderBackend,
  createWorkerRenderBackend,
  resolveRenderMode,
  RENDER_MESH_KIND,
  RENDER_POSE_STRIDE,
} from '../src/runtime/threading/renderBackend.js';
import { handleMessage as handleRenderWorkerMessage } from '../src/runtime/threading/render.worker.js';
import { createFrameBridge } from '../src/runtime/threading/frameBridge.js';
import {
  BODY_TYPE,
  createPhysicsBackend,
  POSE_STRIDE,
} from '../src/runtime/threading/physicsBackend.js';

/**
 * In-process Worker stand-in for render.worker handleMessage.
 * OffscreenCanvas / WebGL are stubbed — protocol only.
 */
function createMockRenderWorker(overrides = {}) {
  const listeners = new Set();
  /** @type {object | null} */
  let lastInit = null;
  const state = {
    meshes: new Map(),
    presents: 0,
    lastPoses: null,
    ...overrides,
  };
  const worker = {
    onmessage: null,
    postMessage(message) {
      queueMicrotask(() => {
        // Protocol-level handling without real Three/WebGL in Node.
        let response = null;
        try {
          const type = message?.type;
          if (type === 'init') {
            lastInit = message;
            response = { type: 'ready', kind: 'worker' };
          } else if (type === 'present') {
            state.presents += 1;
            response = {
              type: 'presented',
              requestId: message.requestId,
              ms: 1.5,
              drawCalls: state.meshes.size,
              triangles: state.meshes.size * 100,
            };
          } else if (type === 'upsertMesh') {
            const mesh = message.mesh || message;
            state.meshes.set(mesh.id, mesh);
            response = message.requestId != null
              ? { type: 'acked', requestId: message.requestId, id: mesh.id }
              : null;
          } else if (type === 'removeMesh') {
            state.meshes.delete(message.id);
            response = message.requestId != null
              ? { type: 'acked', requestId: message.requestId, ok: true }
              : null;
          } else if (type === 'applyPoses') {
            state.lastPoses = message.buffer;
            response = message.requestId != null
              ? { type: 'acked', requestId: message.requestId, applied: state.meshes.size }
              : null;
          } else if (type === 'resize' || type === 'setCamera' || type === 'setClearColor') {
            response = message.requestId != null
              ? { type: 'acked', requestId: message.requestId }
              : null;
          } else if (type === 'dispose') {
            response = { type: 'disposed', requestId: message.requestId };
          } else {
            // Fall through to real handleMessage for coverage when possible.
            response = handleRenderWorkerMessage(message);
          }
        } catch (error) {
          response = {
            type: 'error',
            requestId: message?.requestId,
            message: error?.message || String(error),
          };
        }
        if (!response) return;
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
    _state: state,
    _lastInit: () => lastInit,
  };
  return worker;
}

function createFakeRenderer() {
  let renders = 0;
  return {
    renders: () => renders,
    render() { renders += 1; },
    setSize() {},
    setPixelRatio() {},
    dispose() {},
  };
}

test('resolveRenderMode defaults to main', () => {
  assert.equal(resolveRenderMode({}), 'main');
  assert.equal(resolveRenderMode({ mode: 'worker' }), 'worker');
  assert.equal(resolveRenderMode({ mode: 'auto' }), 'auto');
  assert.equal(resolveRenderMode({ mode: 'nope' }), 'main');
});

test('RENDER_POSE_STRIDE matches physics pose stride', () => {
  assert.equal(RENDER_POSE_STRIDE, POSE_STRIDE);
  assert.equal(RENDER_MESH_KIND.SPHERE, 'sphere');
});

test('main render backend presents synchronously', () => {
  const renderer = createFakeRenderer();
  const backend = createMainRenderBackend({
    renderer,
    scene: {},
    camera: {},
  });
  assert.equal(backend.kind, 'main');
  const result = backend.present();
  assert.equal(result.presented, true);
  assert.equal(result.deferred, false);
  assert.equal(renderer.renders(), 1);
  assert.ok(backend.lastPresentMs >= 0);
  backend.dispose();
});

test('createRenderBackend main mode wraps host renderer', () => {
  const renderer = createFakeRenderer();
  const backend = createRenderBackend({
    mode: 'main',
    renderer,
    scene: {},
    camera: {},
  });
  backend.present();
  assert.equal(renderer.renders(), 1);
  backend.dispose();
});

test('createRenderBackend worker mode falls back when canvas missing', () => {
  let fellBack = false;
  const renderer = createFakeRenderer();
  const backend = createRenderBackend({
    mode: 'auto',
    renderer,
    scene: {},
    camera: {},
    onFallback: () => { fellBack = true; },
  });
  assert.equal(backend.kind, 'main');
  assert.equal(fellBack, true);
  backend.dispose();
});

test('worker render proxy presentAsync completes via mock worker', async () => {
  const mock = createMockRenderWorker();
  const offscreen = { width: 64, height: 48 }; // stand-in OffscreenCanvas
  const backend = createWorkerRenderBackend({
    worker: mock,
    offscreen,
    width: 64,
    height: 48,
    pixelRatio: 1,
  });
  await backend.whenReady();
  assert.equal(backend.kind, 'worker');

  backend.upsertMesh({ id: 1, kind: 'sphere', radius: 0.3, position: [0, 1, 0] });
  backend.applyPoses(new Float32Array(RENDER_POSE_STRIDE), { idOrder: [1] });

  const result = await backend.presentAsync();
  assert.equal(result.presented, true);
  assert.ok(result.ms >= 0);
  assert.equal(mock._state.presents, 1);

  // Non-blocking present is fire-and-forget (deferred).
  const deferred = backend.present();
  assert.equal(deferred.deferred, true);

  backend.dispose();
});

test('render worker handleMessage rejects present before init', () => {
  const err = handleRenderWorkerMessage({ type: 'present', requestId: 1 });
  assert.equal(err.type, 'error');
  assert.match(err.message, /not initialized/i);
});

test('frameBridge ticks physics then present on main backends', () => {
  const physics = createPhysicsBackend({ mode: 'main', gravity: [0, -10, 0] });
  const ballId = physics.addBody({
    shape: 'sphere',
    radius: 0.2,
    position: [0, 4, 0],
    mass: 1,
    type: BODY_TYPE.DYNAMIC,
  });
  const renderer = createFakeRenderer();
  const render = createMainRenderBackend({ renderer, scene: {}, camera: {} });
  const bridge = createFrameBridge({
    physics,
    render,
    meshIds: [ballId],
  });

  const result = bridge.tick(1 / 60);
  assert.equal(result.presented, true);
  assert.equal(result.physicsKind, 'main');
  assert.equal(result.renderKind, 'main');
  assert.equal(renderer.renders(), 1);
  assert.ok(bridge.ticks >= 1);

  // Advance sim a bit
  for (let i = 0; i < 20; i += 1) bridge.tick(1 / 60);
  const pose = physics.getPose(ballId);
  assert.ok(pose[1] < 3.8);

  bridge.dispose();
  physics.dispose();
  render.dispose();
});

test('frameBridge tickAsync with worker render mock', async () => {
  const physics = createPhysicsBackend({ mode: 'main', gravity: [0, -10, 0] });
  const ballId = physics.addBody({
    shape: 'sphere',
    radius: 0.2,
    position: [0, 5, 0],
    mass: 1,
    type: BODY_TYPE.DYNAMIC,
  });

  const mock = createMockRenderWorker();
  const render = createWorkerRenderBackend({
    worker: mock,
    offscreen: { width: 32, height: 32 },
    width: 32,
    height: 32,
  });
  await render.whenReady();
  render.upsertMesh({ id: ballId, kind: 'sphere', radius: 0.2, position: [0, 5, 0] });

  const bridge = createFrameBridge({
    physics,
    render,
    meshIds: [ballId],
  });

  const result = await bridge.tickAsync(1 / 30);
  assert.equal(result.presented, true);
  assert.ok(mock._state.lastPoses, 'poses forwarded to render worker');
  assert.equal(mock._state.lastPoses.length, POSE_STRIDE);
  assert.ok(mock._state.presents >= 1);

  bridge.dispose();
  physics.dispose();
  render.dispose();
});

test('canUseOffscreenCanvas is boolean in Node', () => {
  assert.equal(typeof canUseOffscreenCanvas(), 'boolean');
});
