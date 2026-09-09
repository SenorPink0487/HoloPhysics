import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimBackend,
  createMainSimBackend,
  createWorkerSimBackend,
  createCalorimetryMixKind,
  createHeatConductionKind,
  createIdealGasKind,
  createConvectionKind,
  createThermoKind,
  createElectricFieldLinesKind,
  createGaussMetricsKind,
  createHallCarriersKind,
  createDiffractionFringeKind,
  createGeometricAnglesKind,
  createSimKind,
  resolveSimMode,
  preferredWorkerSlot,
  resolveSimWorkerPoolSize,
  disposeSimWorkerPool,
  acquireSimWorker,
  releaseSimWorker,
  simWorkerPoolStats,
  SIM_KIND,
  PARTICLE_STRIDE_POS_VEL,
  PARTICLE_STRIDE_POS_VEL_TEMP,
} from '../src/runtime/threading/simBackend.js';
import { handleMessage } from '../src/runtime/threading/sim.worker.js';

/**
 * In-process Worker stand-in: routes postMessage through sim.worker handleMessage.
 */
function createMockSimWorker() {
  const listeners = new Set();
  const worker = {
    onmessage: null,
    postMessage(message) {
      queueMicrotask(() => {
        const response = handleMessage(message);
        if (!response) return;
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

test('resolveSimMode defaults to auto', () => {
  assert.equal(resolveSimMode({}), 'auto');
  assert.equal(resolveSimMode({ mode: 'main' }), 'main');
  assert.equal(resolveSimMode({ mode: 'worker' }), 'worker');
});

test('SIM_KIND ids are stable', () => {
  assert.equal(SIM_KIND.CALORIMETRY_MIX, 'thermo.calorimetryMix');
  assert.equal(SIM_KIND.HEAT_CONDUCTION, 'thermo.heatConduction');
  assert.equal(SIM_KIND.IDEAL_GAS, 'thermo.idealGas');
  assert.equal(SIM_KIND.CONVECTION, 'thermo.convection');
  assert.equal(SIM_KIND.ELECTRIC_FIELD_LINES, 'electro.electricFieldLines');
  assert.equal(SIM_KIND.HALL_CARRIERS, 'electro.hallCarriers');
  assert.equal(SIM_KIND.GAUSS_METRICS, 'electro.gaussMetrics');
  assert.equal(SIM_KIND.DIFFRACTION_FRINGE, 'optics.diffractionFringe');
  assert.equal(SIM_KIND.GEOMETRIC_ANGLES, 'optics.geometricAngles');
  assert.equal(PARTICLE_STRIDE_POS_VEL, 6);
  assert.equal(PARTICLE_STRIDE_POS_VEL_TEMP, 7);
});

test('preferredWorkerSlot pins continuous particles to slot 1', () => {
  assert.equal(preferredWorkerSlot(SIM_KIND.CALORIMETRY_MIX), 0);
  assert.equal(preferredWorkerSlot(SIM_KIND.HEAT_CONDUCTION), 0);
  assert.equal(preferredWorkerSlot(SIM_KIND.ELECTRIC_FIELD_LINES), 0);
  assert.equal(preferredWorkerSlot(SIM_KIND.DIFFRACTION_FRINGE), 0);
  assert.equal(preferredWorkerSlot(SIM_KIND.CONVECTION), 1);
  assert.equal(preferredWorkerSlot(SIM_KIND.IDEAL_GAS), 1);
  assert.equal(preferredWorkerSlot(SIM_KIND.HALL_CARRIERS), 1);
});

test('sim worker pool size is 0 without Worker (Node)', () => {
  disposeSimWorkerPool();
  // Node test runner has no Worker → pool size 0 unless forced.
  assert.equal(resolveSimWorkerPoolSize(), 0);
});

test('sim worker pool is exclusive per slot and stays warm on release', () => {
  disposeSimWorkerPool();
  const prevPool = globalThis.__SIM_WORKER_POOL__;
  const prevSize = globalThis.__SIM_WORKER_POOL_SIZE__;
  globalThis.__SIM_WORKER_POOL_SIZE__ = 2;
  try {
    let created = 0;
    class FakeWorker {
      constructor() {
        created += 1;
      }
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      terminate() {}
    }

    const a = acquireSimWorker(0, { WorkerCtor: FakeWorker });
    assert.ok(a, 'first acquire should succeed');
    assert.equal(created, 1);
    const busy = acquireSimWorker(0, { WorkerCtor: FakeWorker });
    assert.equal(busy, null, 'busy slot must not share worker');
    assert.equal(created, 1, 'busy acquire must not spawn another pooled worker');

    const b = acquireSimWorker(1, { WorkerCtor: FakeWorker });
    assert.ok(b, 'slot 1 is independent');
    assert.equal(created, 2);

    releaseSimWorker(0, a);
    const stats = simWorkerPoolStats();
    assert.ok(stats.live.includes(0), 'released slot stays warm');
    assert.equal(stats.refs[0] || 0, 0);

    const c = acquireSimWorker(0, { WorkerCtor: FakeWorker });
    assert.ok(c, 'warm re-acquire works');
    assert.equal(c, a, 'same pooled worker instance');
    assert.equal(created, 2, 'no third worker after warm re-acquire');
    releaseSimWorker(0, c);
    releaseSimWorker(1, b);
  } finally {
    disposeSimWorkerPool();
    if (prevPool === undefined) delete globalThis.__SIM_WORKER_POOL__;
    else globalThis.__SIM_WORKER_POOL__ = prevPool;
    if (prevSize === undefined) delete globalThis.__SIM_WORKER_POOL_SIZE__;
    else globalThis.__SIM_WORKER_POOL_SIZE__ = prevSize;
  }
});

test('calorimetry mix kind advances toward teq', () => {
  const kind = createCalorimetryMixKind({
    mHot: 200,
    mCold: 200,
    tHot: 80,
    tCold: 20,
    cupHot: true,
    cupCold: true,
    pouring: false,
  });
  const teq = (200 * 80 + 200 * 20) / 400;
  let last = kind.getSnapshot();
  for (let i = 0; i < 120; i += 1) {
    last = kind.step(1 / 60);
  }
  assert.ok(last.scalars.mixProgress > 0.5);
  assert.ok(Math.abs(last.scalars.teq - teq) < 1e-6);
  assert.ok(last.scalars.tCurrent > 20);
  assert.ok(last.scalars.tCurrent <= teq + 0.5);
  kind.dispose();
});

test('heat conduction kind relaxes interior temperature', () => {
  // Few segments so heat from the hot end reaches neighbors quickly.
  const temps = new Float32Array(8).fill(300);
  temps[0] = 700;
  temps[7] = 280;
  const kind = createHeatConductionKind({
    segments: 8,
    temps,
    tHot: 700,
    tCold: 280,
    conductivity: 2.5,
    running: true,
  });
  const nearHot0 = kind.getSnapshot().fields.temps[1];
  for (let i = 0; i < 60; i += 1) kind.step(1 / 60);
  const snap = kind.getSnapshot();
  const nearHot1 = snap.fields.temps[1];
  // Neighbor of hot end should warm above the initial fill.
  assert.ok(nearHot1 > nearHot0);
  assert.ok(nearHot1 > 300);
  assert.equal(snap.fields.temps[0], 700);
  assert.equal(snap.fields.temps[7], 280);
  kind.dispose();
});

test('ideal gas kind steps particles and reports collisions', () => {
  const kind = createIdealGasKind({
    count: 40,
    temperature: 400,
    volume: 1,
    seed: 42,
  });
  const before = kind.getSnapshot().particles.slice();
  kind.step(1 / 60);
  const after = kind.getSnapshot().particles;
  assert.equal(after.length, 40 * PARTICLE_STRIDE_POS_VEL);
  let moved = 0;
  for (let i = 0; i < after.length; i += PARTICLE_STRIDE_POS_VEL) {
    if (after[i] !== before[i] || after[i + 1] !== before[i + 1]) moved += 1;
  }
  assert.ok(moved > 0, 'particles should move');
  for (let i = 0; i < 30; i += 1) kind.step(1 / 60);
  assert.ok(Number.isFinite(kind.getSnapshot().scalars.collisionsPerSec));
  kind.dispose();
});

test('createThermoKind dispatches known ids', () => {
  const a = createThermoKind(SIM_KIND.CALORIMETRY_MIX, { tHot: 70 });
  assert.equal(a.kind, SIM_KIND.CALORIMETRY_MIX);
  a.dispose();
  assert.throws(() => createThermoKind('thermo.nope'), /Unknown thermo/);
});

test('convection kind steps plume particles (stride-7)', () => {
  const kind = createConvectionKind({
    count: 48,
    tPlate: 700,
    tAir: 300,
    area: 0.12,
    running: true,
    seed: 3,
  });
  const before = kind.getSnapshot().particles.slice();
  for (let i = 0; i < 30; i += 1) kind.step(1 / 60);
  const snap = kind.getSnapshot();
  assert.equal(snap.particles.length, 48 * PARTICLE_STRIDE_POS_VEL_TEMP);
  assert.ok(snap.scalars.deltaT > 0);
  assert.ok(snap.scalars.q > 0);
  let moved = 0;
  for (let i = 0; i < snap.particles.length; i += PARTICLE_STRIDE_POS_VEL_TEMP) {
    if (snap.particles[i] !== before[i] || snap.particles[i + 1] !== before[i + 1]) moved += 1;
  }
  assert.ok(moved > 0, 'plume particles should move');
  kind.dispose();
});

test('electric field lines kind packs polylines', () => {
  const kind = createElectricFieldLinesKind({
    charges: [
      { q: 1, x: 0, y: 0, z: 0 },
      { q: -1, x: 1.5, y: 0, z: 0 },
    ],
  });
  const snap = kind.step(1 / 60);
  assert.ok(snap.scalars.lineCount > 0);
  assert.ok(snap.fields.fieldLines[0] > 0);
  assert.ok(snap.fields.fieldLines.length > 4);
  kind.dispose();
});

test('gauss metrics kind reports enclosed charge and flux', () => {
  const kind = createGaussMetricsKind({
    charges: [{ q: 2, x: 0, y: 0, z: 0 }],
    radius: 2.4,
  });
  const snap = kind.step(0);
  assert.equal(snap.scalars.qEnclosed, 2);
  assert.ok(snap.scalars.flux > 0);
  assert.ok(snap.scalars.meanField > 0);
  kind.command('setParams', {
    charges: [{ q: 2, x: 5, y: 0, z: 0 }],
  });
  const outside = kind.step(0);
  assert.equal(outside.scalars.qEnclosed, 0);
  kind.dispose();
});

test('hall carriers kind steps particles and reports Vh', () => {
  const kind = createHallCarriersKind({
    count: 40,
    I: 1,
    B: 1,
    n: 1,
    d: 0.5,
    nType: true,
    seed: 9,
  });
  const before = kind.getSnapshot().particles.slice();
  for (let i = 0; i < 20; i += 1) kind.step(1 / 60);
  const snap = kind.getSnapshot();
  assert.equal(snap.particles.length, 40 * PARTICLE_STRIDE_POS_VEL);
  assert.ok(Number.isFinite(snap.scalars.vh));
  let moved = 0;
  for (let i = 0; i < snap.particles.length; i += PARTICLE_STRIDE_POS_VEL) {
    if (snap.particles[i] !== before[i]) moved += 1;
  }
  assert.ok(moved > 0);
  kind.dispose();
});

test('diffraction fringe kind samples intensity curve', () => {
  const kind = createDiffractionFringeKind({
    lambdaNm: 550,
    slitMm: 0.05,
    pitchMm: 0.25,
    N: 2,
    distM: 1,
    samples: 64,
  });
  const snap = kind.step(0);
  assert.equal(snap.fields.intensity.length, 64);
  // Central maximum should be near peak intensity.
  const mid = snap.fields.intensity[32];
  const edge = snap.fields.intensity[0];
  assert.ok(mid >= edge, 'central fringe brighter than edge');
  assert.ok(snap.scalars.fringeSpacingMm > 0);
  kind.dispose();
});

test('geometric angles kind computes Snell / reflect', () => {
  const kind = createGeometricAnglesKind({
    angle: 30,
    ior: 1.5,
    mode: 'refract',
  });
  const snap = kind.step(0);
  assert.ok(Math.abs(snap.scalars.theta1 - 30) < 1e-6);
  assert.ok(snap.scalars.thetaRefract != null);
  assert.ok(snap.scalars.thetaRefract < 30);
  assert.equal(snap.scalars.tir, false);
  kind.command('setParams', { angle: 80, ior: 1.33, mode: 'refract' });
  // air→glass with large angle may TIR only when n2 < n1; for n=1.33 from air TIR is rare.
  // Reflect mode:
  kind.command('setParams', { angle: 40, mode: 'reflect' });
  const refl = kind.step(0);
  assert.equal(refl.scalars.thetaReflect, 40);
  kind.dispose();
});

test('createSimKind routes thermo / electro / optics prefixes', () => {
  const t = createSimKind(SIM_KIND.CONVECTION, { count: 16 });
  assert.equal(t.kind, SIM_KIND.CONVECTION);
  t.dispose();
  const e = createSimKind(SIM_KIND.GAUSS_METRICS, { charges: [] });
  assert.equal(e.kind, SIM_KIND.GAUSS_METRICS);
  e.dispose();
  const o = createSimKind(SIM_KIND.GEOMETRIC_ANGLES, { angle: 20 });
  assert.equal(o.kind, SIM_KIND.GEOMETRIC_ANGLES);
  o.dispose();
  assert.throws(() => createSimKind('unknown.foo'), /unsupported kind/);
});

test('main SimBackend steps calorimetry synchronously', () => {
  const backend = createMainSimBackend({
    kind: SIM_KIND.CALORIMETRY_MIX,
    options: {
      cupHot: true,
      cupCold: true,
      pouring: false,
      tHot: 80,
      tCold: 20,
      mHot: 200,
      mCold: 200,
    },
  });
  assert.equal(backend.kind, 'main');
  const snap = backend.step(1 / 30);
  assert.equal(snap.deferred, false);
  assert.ok(snap.scalars.mixProgress > 0);
  assert.ok(snap.generation >= 2);
  backend.command('reset');
  const after = backend.getSnapshot();
  assert.equal(after.scalars.mixProgress, 0);
  backend.dispose();
});

test('createSimBackend mode main forces main path', () => {
  const backend = createSimBackend({
    kind: SIM_KIND.HEAT_CONDUCTION,
    mode: 'main',
    options: { segments: 16, tHot: 600, tCold: 300, running: true },
  });
  assert.equal(backend.kind, 'main');
  backend.step(0.02);
  assert.ok(backend.getSnapshot().fields.temps.length === 16);
  backend.dispose();
});

test('worker SimBackend protocol via mock worker (latest-complete-wins)', async () => {
  const worker = createMockSimWorker();
  const backend = createWorkerSimBackend({
    kind: SIM_KIND.CALORIMETRY_MIX,
    options: {
      cupHot: true,
      cupCold: true,
      pouring: false,
      tHot: 90,
      tCold: 10,
      mHot: 150,
      mCold: 150,
    },
    worker,
  });
  await backend.whenReady();
  const first = backend.step(1 / 60);
  // Immediate return is deferred; snapshot arrives async.
  assert.equal(first.deferred, true);
  const snap = await backend.stepAsync(1 / 60);
  assert.equal(snap.deferred, false);
  assert.ok(snap.scalars.mixProgress > 0);
  assert.ok(snap.generation >= 2);
  backend.dispose();
});

test('sim.worker handleMessage init/step/dispose', () => {
  const ready = handleMessage({
    type: 'init',
    kind: SIM_KIND.HEAT_CONDUCTION,
    options: { segments: 8, tHot: 500, tCold: 300 },
  });
  assert.equal(ready.type, 'ready');
  const snapMsg = handleMessage({ type: 'step', requestId: 7, dt: 0.02 });
  assert.equal(snapMsg.type, 'snapshot');
  assert.equal(snapMsg.requestId, 7);
  assert.ok(snapMsg.fields.temps.length === 8);
  const done = handleMessage({ type: 'dispose', requestId: 8 });
  assert.equal(done.type, 'disposed');
});

test('thermo handlers drive calorimetry mix through SimBackend', async () => {
  const prev = globalThis.__SIM_BACKEND_MODE__;
  globalThis.__SIM_BACKEND_MODE__ = 'main';
  try {
    const { createHandlers } = await import('../src/experiments/thermo.js');
    const state = { expId: 'calorimetry', stepIndex: 0, data: null, running: true };
    const equipment = {
      thermo: {
        updateState: () => {},
        setMode: () => {},
        reset: () => {},
        getPourState: () => ({ active: false }),
      },
    };
    const handlers = createHandlers({
      state,
      equipment,
      toast: () => {},
      pushHud: () => {},
      advanceStep: () => {},
      setStep: () => {},
      currentStep: () => ({ id: 'equilibrate' }),
      currentExp: () => null,
      currentStation: () => null,
    });
    state.data = handlers.initData('calorimetry');
    state.data.cupHot = true;
    state.data.cupCold = true;
    state.data.pouring = null;
    state.data.tCurrent = state.data.tCold;
    handlers.applyVisualDefaults('calorimetry');
    for (let i = 0; i < 90; i += 1) handlers.update(0, 1 / 60);
    assert.ok(state.data.mixProgress > 0.4, `mix should advance, got ${state.data.mixProgress}`);
    assert.ok(state.data.tCurrent > state.data.tCold);
    handlers.cleanup('calorimetry');
  } finally {
    if (prev === undefined) delete globalThis.__SIM_BACKEND_MODE__;
    else globalThis.__SIM_BACKEND_MODE__ = prev;
  }
});

test('thermo handlers drive convection through SimBackend', async () => {
  const prev = globalThis.__SIM_BACKEND_MODE__;
  globalThis.__SIM_BACKEND_MODE__ = 'main';
  try {
    const { createHandlers } = await import('../src/experiments/thermo.js');
    const particles = Array.from({ length: 60 }, () => ({
      x: 0, y: 0.5, z: 0, vx: 0, vy: 0, vz: 0, temp: 300, size: 0.1,
    }));
    const state = { expId: 'convection', stepIndex: 0, data: null, running: true };
    const equipment = {
      thermo: {
        updateState: () => {},
        setMode: () => {},
        reset: () => {},
        sourceExperiments: {
          convection: { particles, _hostParticlesOwned: false },
        },
      },
    };
    const handlers = createHandlers({
      state,
      equipment,
      toast: () => {},
      pushHud: () => {},
      advanceStep: () => {},
      setStep: () => {},
      currentStep: () => ({ id: 'observe' }),
      currentExp: () => null,
      currentStation: () => null,
    });
    state.data = handlers.initData('convection');
    handlers.applyVisualDefaults('convection');
    const y0 = particles[0].y;
    for (let i = 0; i < 45; i += 1) handlers.update(0, 1 / 60);
    // Host should have pushed sim particles into the source paint list.
    assert.ok(
      equipment.thermo.sourceExperiments.convection._hostParticlesOwned,
      'convection source should be host-owned',
    );
    let changed = false;
    for (let i = 0; i < particles.length; i += 1) {
      if (particles[i].y !== y0 || particles[i].temp !== 300) {
        changed = true;
        break;
      }
    }
    assert.ok(changed, 'convection particles should update from SimBackend');
    handlers.cleanup('convection');
  } finally {
    if (prev === undefined) delete globalThis.__SIM_BACKEND_MODE__;
    else globalThis.__SIM_BACKEND_MODE__ = prev;
  }
});

test('worker protocol handles electro field lines + optics fringe', () => {
  const ready = handleMessage({
    type: 'init',
    kind: SIM_KIND.ELECTRIC_FIELD_LINES,
    options: { charges: [{ q: 1, x: 0, y: 0, z: 0 }] },
  });
  assert.equal(ready.type, 'ready');
  const snap = handleMessage({ type: 'step', requestId: 3, dt: 0.02 });
  assert.equal(snap.type, 'snapshot');
  assert.ok(snap.fields.fieldLines.length > 1);

  const ready2 = handleMessage({
    type: 'reinit',
    kind: SIM_KIND.DIFFRACTION_FRINGE,
    options: { samples: 32, N: 2 },
  });
  assert.equal(ready2.type, 'ready');
  const fringe = handleMessage({ type: 'step', requestId: 4, dt: 0 });
  assert.equal(fringe.type, 'snapshot');
  assert.equal(fringe.fields.intensity.length, 32);
  handleMessage({ type: 'dispose' });
});

test('createSimBackend exposes workerSlot from preferredWorkerSlot', () => {
  const backend = createSimBackend({
    kind: SIM_KIND.CONVECTION,
    mode: 'main',
    options: { count: 16, tPlate: 600, tAir: 300 },
  });
  assert.equal(backend.kind, 'main');
  assert.equal(backend.workerSlot, 1);
  backend.step(0.02);
  assert.ok(backend.getSnapshot().particles.length > 0);
  backend.dispose();
});

test('worker sim backend removes message listener on dispose for pooled worker reuse', () => {
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

  const backend = createWorkerSimBackend({
    kind: SIM_KIND.CALORIMETRY_MIX,
    worker,
    usePool: false,
  });

  assert.ok(listeners.size >= 1 || typeof worker.onmessage === 'function', 'listener registered');
  backend.dispose();
  assert.equal(listeners.size, 0, 'listeners set must be empty after dispose');
  assert.equal(worker.onmessage, null, 'onmessage must be null after dispose');
});


