import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_TYPE,
  POSE_STRIDE,
  RENDER_POSE_STRIDE,
  RENDER_MESH_KIND,
  PRIMARY_LAB_CANVAS_ID,
  canUseOffscreenCanvas,
  createFrameBridge,
  createOffscreenIsland,
  createPhysicsBackend,
  createRenderBackend,
  createSharedPoseBuffer,
  createSimDriver,
  createSimBackend,
  createConvectionKind,
  createElectricFieldLinesKind,
  createDiffractionFringeKind,
  preferredWorkerSlot,
  resolveSimWorkerPoolSize,
  isPrimaryLabCanvas,
  isSharedArrayBufferAvailable,
  resolvePhysicsMode,
  resolveRenderMode,
  resolveSimMode,
  shouldUseSharedPoses,
  SIM_KIND,
} from '../src/runtime/threading/index.js';
import { MechanicsSourceRuntime } from '../src/scene/stations/mechanicsSourceRuntime.js';

test('index barrel re-exports physics + render + bridge + sim symbols', () => {
  assert.equal(POSE_STRIDE, 10);
  assert.equal(RENDER_POSE_STRIDE, POSE_STRIDE);
  assert.equal(BODY_TYPE.DYNAMIC, 1);
  assert.equal(RENDER_MESH_KIND.SPHERE, 'sphere');
  assert.equal(PRIMARY_LAB_CANVAS_ID, 'c');
  assert.equal(typeof createPhysicsBackend, 'function');
  assert.equal(typeof createRenderBackend, 'function');
  assert.equal(typeof createFrameBridge, 'function');
  assert.equal(typeof createOffscreenIsland, 'function');
  assert.equal(typeof createSimDriver, 'function');
  assert.equal(typeof createSimBackend, 'function');
  assert.equal(typeof createConvectionKind, 'function');
  assert.equal(typeof createElectricFieldLinesKind, 'function');
  assert.equal(typeof createDiffractionFringeKind, 'function');
  assert.equal(typeof preferredWorkerSlot, 'function');
  assert.equal(typeof resolveSimWorkerPoolSize, 'function');
  assert.equal(typeof resolvePhysicsMode, 'function');
  assert.equal(typeof resolveRenderMode, 'function');
  assert.equal(typeof resolveSimMode, 'function');
  assert.equal(typeof canUseOffscreenCanvas, 'function');
  assert.equal(typeof isSharedArrayBufferAvailable, 'function');
  assert.equal(typeof createSharedPoseBuffer, 'function');
  assert.equal(typeof shouldUseSharedPoses, 'function');
  assert.equal(resolvePhysicsMode({}), 'auto');
  assert.equal(resolveSimMode({}), 'auto');
  assert.equal(SIM_KIND.CALORIMETRY_MIX, 'thermo.calorimetryMix');
  assert.equal(SIM_KIND.CONVECTION, 'thermo.convection');
  assert.equal(SIM_KIND.HALL_CARRIERS, 'electro.hallCarriers');
  assert.equal(preferredWorkerSlot(SIM_KIND.CONVECTION), 1);
});

test('mechanics runtime inherits the host physics mode unless explicitly overridden', () => {
  const inherited = new MechanicsSourceRuntime({
    id: 'free-fall',
    camera: null,
    renderer: null,
  });
  const explicit = new MechanicsSourceRuntime({
    id: 'free-fall',
    camera: null,
    renderer: null,
    physicsMode: 'auto',
  });

  assert.equal(inherited.physicsMode, undefined);
  assert.equal(explicit.physicsMode, 'auto');
});

test('isPrimaryLabCanvas guards #c and data-lab-primary', () => {
  assert.equal(isPrimaryLabCanvas(null), false);
  assert.equal(isPrimaryLabCanvas({ id: 'c' }), true);
  assert.equal(isPrimaryLabCanvas({ id: 'preview' }), false);
  assert.equal(isPrimaryLabCanvas({
    id: 'other',
    dataset: { labPrimary: 'true' },
  }), true);
  assert.equal(isPrimaryLabCanvas({
    id: 'other',
    getAttribute: (name) => (name === 'data-lab-primary' ? 'true' : null),
  }), true);
});

test('createOffscreenIsland refuses primary lab canvas', () => {
  assert.throws(
    () => createOffscreenIsland({ canvas: { id: 'c' } }),
    /primary lab canvas/i,
  );
});

test('createOffscreenIsland allowPrimaryCanvas bypass is explicit', () => {
  const island = createOffscreenIsland({
    canvas: { id: 'c' },
    allowPrimaryCanvas: true,
    physicsMode: 'main',
    renderMode: 'main',
  });
  assert.equal(island.kind, 'offscreenIsland');
  assert.equal(island.usesWorkerPhysics, false);
  assert.equal(island.usesWorkerRender, false);
  island.dispose();
});

test('createOffscreenIsland ticks free-fall with stub render on main', () => {
  const island = createOffscreenIsland({
    physicsMode: 'main',
    renderMode: 'main',
    gravity: [0, -10, 0],
  });
  assert.equal(island.physics.kind, 'main');
  assert.equal(island.render.kind, 'main');

  const ballId = island.addDemoSphere({ position: [0, 5, 0], radius: 0.2 });
  assert.ok(island.meshIds.includes(ballId));

  const before = island.physics.getPose(ballId);
  assert.ok(before);
  assert.equal(before[1], 5); // py

  const result = island.tick(1 / 60);
  assert.equal(result.presented, true);
  assert.equal(result.physicsKind, 'main');
  assert.ok(result.steps >= 1);

  const after = island.physics.getPose(ballId);
  assert.ok(after[1] < 5, 'ball should drop under gravity');

  // Several more steps to ensure bridge stays healthy.
  for (let i = 0; i < 30; i += 1) island.tick(1 / 60);
  assert.ok(island.bridge.ticks > 30);

  assert.equal(island.dispose(), true);
  assert.equal(island.dispose(), false);
  const disposedTick = island.tick(1 / 60);
  assert.equal(disposedTick.disposed, true);
});

test('createOffscreenIsland accepts injected physics + render', () => {
  const physics = createPhysicsBackend({ mode: 'main', gravity: [0, -9.81, 0] });
  const floorId = physics.addBody({ shape: 'plane', type: BODY_TYPE.STATIC, mass: 0 });
  const ballId = physics.addBody({
    shape: 'sphere',
    radius: 0.25,
    position: [0, 2, 0],
    mass: 1,
    type: BODY_TYPE.DYNAMIC,
  });

  let presents = 0;
  const render = createRenderBackend({
    mode: 'main',
    renderer: {
      render() { presents += 1; },
      setSize() {},
      dispose() {},
    },
    scene: {},
    camera: {},
  });

  const island = createOffscreenIsland({
    physics,
    render,
    meshIds: [ballId],
  });

  const result = island.tick(1 / 60);
  assert.equal(result.presented, true);
  assert.equal(presents, 1);
  assert.notEqual(floorId, ballId);

  island.dispose();
});

test('createFrameBridge from index exports works with empty meshIds', () => {
  const physics = createPhysicsBackend({ mode: 'main' });
  const render = createRenderBackend({
    mode: 'main',
    renderer: { render() {}, setSize() {}, dispose() {} },
    scene: {},
    camera: {},
  });
  const bridge = createFrameBridge({ physics, render, meshIds: [] });
  const result = bridge.tick(1 / 60);
  assert.equal(result.presented, true);
  // No dynamics → physics may skip.
  assert.ok(result.steps === 0 || result.skipped === true || result.steps >= 0);
  bridge.dispose();
  physics.dispose();
  render.dispose();
});
