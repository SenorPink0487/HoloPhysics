import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createResourceScope, createSharedResourcePool } from '../src/runtime/resourceScope.js';
import { createRuntimeCache } from '../src/runtime/runtimeCache.js';
import { createFrameCoordinator } from '../src/runtime/frameCoordinator.js';
import { createEquipmentRuntime, createExperimentRuntime, createTransitionController } from '../src/runtime/experimentRuntime.js';
import { createStationEquipment as createMechanicsStationEquipment } from '../src/scene/stations/mechanics.js';
import { createStationEquipment } from '../src/scene/stations/thermo.js';
import { CalorimetryExperiment } from '../src/reli/experiments/calorimetry.js';
import { ConvectionExperiment } from '../src/reli/experiments/convection.js';
import { HeatConductionExperiment } from '../src/reli/experiments/heatConduction.js';
import { IdealGasExperiment } from '../src/reli/experiments/idealGas.js';
import { ThermalExpansionExperiment } from '../src/reli/experiments/thermalExpansion.js';

if (!globalThis.document) {
  const createTestElement = (tagName = 'div') => {
    const element = {
      tagName: String(tagName).toUpperCase(),
      children: [],
      childNodes: [],
      parentNode: null,
      style: {},
      dataset: {},
      className: '',
      textContent: '',
      innerHTML: '',
      value: '',
      type: '',
      min: '',
      max: '',
      step: '',
      selected: false,
      disabled: false,
      hidden: false,
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains: () => false,
      },
      append(...nodes) {
        nodes.flat().filter(Boolean).forEach((node) => {
          this.children.push(node);
          this.childNodes.push(node);
          node.parentNode = this;
        });
      },
      appendChild(node) {
        this.append(node);
        return node;
      },
      removeChild(node) {
        this.children = this.children.filter((child) => child !== node);
        this.childNodes = this.childNodes.filter((child) => child !== node);
        if (node) node.parentNode = null;
        return node;
      },
      remove() {
        this.parentNode?.removeChild?.(this);
      },
      setAttribute(name, value) {
        this[name] = String(value);
      },
      getAttribute(name) {
        return this[name] ?? null;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      contains: () => false,
      focus() {},
      blur() {},
      click() {},
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 8, height: 8 }),
      getContext: () => ({
        clearRect() {},
        fillRect() {},
        strokeRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        arcTo() {},
        arc() {},
        bezierCurveTo() {},
        closePath() {},
        fill() {},
        stroke() {},
        fillText() {},
        measureText: () => ({ width: 0 }),
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }),
      }),
    };
    return element;
  };

  globalThis.document = {
    createElement: createTestElement,
    body: createTestElement('body'),
    querySelectorAll: () => [],
  };
}
if (!globalThis.window) {
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1280,
    innerHeight: 720,
  };
}

test('ResourceScope and shared resources dispose exactly once', () => {
  let disposed = 0;
  const scope = createResourceScope('test');
  scope.own({ dispose: () => { disposed += 1; } });
  scope.dispose();
  scope.dispose();
  assert.equal(disposed, 1);

  const pool = createSharedResourcePool();
  let sharedDisposed = 0;
  const a = pool.acquire('geometry', () => ({ id: 1 }), () => { sharedDisposed += 1; });
  const b = pool.acquire('geometry', () => ({ id: 2 }), () => { sharedDisposed += 1; });
  assert.equal(a.value, b.value);
  a.release();
  assert.equal(sharedDisposed, 0);
  b.release();
  b.release();
  assert.equal(sharedDisposed, 1);
});

test('runtime cache keeps active runtime and evicts least-recent warm runtime', () => {
  const disposed = [];
  const runtime = (id, bytes) => ({
    id,
    estimateBytes: () => ({ cpu: bytes, gpu: 0 }),
    suspend() {},
    unmount() {},
    dispose() { disposed.push(id); },
  });
  const cache = createRuntimeCache({ budgetBytes: 10, maxWarm: 2 });
  cache.warm('a', runtime('a', 6));
  cache.warm('b', runtime('b', 3));
  cache.activate('c', runtime('c', 4));
  assert.deepEqual(cache.keys(), ['b', 'c']);
  assert.deepEqual(disposed, ['a']);
});

test('runtime cache budget caps warm at 2 even on high-memory devices', async () => {
  const { runtimeCacheBudget } = await import('../src/runtime/runtimeCache.js');
  assert.deepEqual(runtimeCacheBudget(8), { maxWarm: 2, budgetBytes: 256 * 1024 * 1024 });
  assert.deepEqual(runtimeCacheBudget(4), { maxWarm: 1, budgetBytes: 96 * 1024 * 1024 });
  assert.deepEqual(runtimeCacheBudget(6), { maxWarm: 2, budgetBytes: 192 * 1024 * 1024 });
});

test('runtime cache dispose releases suspend/unmount/dispose on eviction', () => {
  const events = [];
  const runtime = (id) => ({
    id,
    estimateBytes: () => ({ cpu: 5, gpu: 0 }),
    suspend() { events.push(`${id}:suspend`); },
    unmount() { events.push(`${id}:unmount`); },
    dispose() { events.push(`${id}:dispose`); },
  });
  const cache = createRuntimeCache({ budgetBytes: 12, maxWarm: 1 });
  cache.activate('a', runtime('a'));
  cache.warm('b', runtime('b'));
  // active a + warm b already at maxWarm=1; warming c must evict b
  cache.warm('c', runtime('c'));
  assert.ok(events.includes('b:suspend'));
  assert.ok(events.includes('b:unmount'));
  assert.ok(events.includes('b:dispose'));
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('a'), true);
});

test('frame coordinator limits fixed catch-up and runs background work after render', () => {
  const events = [];
  let now = 0;
  const coordinator = createFrameCoordinator({
    now: () => now,
    onFixedUpdate: () => events.push('fixed'),
    onRender: () => events.push('render'),
  });
  coordinator.frame(0);
  coordinator.enqueue({ id: 'small', step: () => { events.push('task'); } });
  now = 100;
  const result = coordinator.frame(100);
  assert.equal(result.steps, 2);
  assert.equal(events.at(-2), 'render');
  assert.equal(events.at(-1), 'task');
});

test('transition controller commits only the newest session', async () => {
  const cache = createRuntimeCache();
  const created = [];
  const controller = createTransitionController({
    cache,
    createRuntime: async (id) => {
      const runtime = createExperimentRuntime({
        id,
        prepare: async (_ctx, signal) => {
          await new Promise((resolve) => setTimeout(resolve, id === 'a' ? 20 : 1));
          if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
        },
        mount: () => {},
        activate: () => { created.push(id); },
      });
      return runtime;
    },
  });
  const first = controller.open('a');
  const second = controller.open('b');
  const results = await Promise.all([first, second]);
  assert.equal(results[0].cancelled, true);
  assert.equal(results[1].committed, true);
  assert.deepEqual(created, ['b']);
});

test('transition controller keeps the previous runtime on prepare failure', async () => {
  const disposed = [];
  const controller = createTransitionController({
    cache: createRuntimeCache(),
    createRuntime: async (id) => createExperimentRuntime({
      id,
      prepare: async () => {
        if (id === 'bad') throw new Error('prepare failed');
      },
      dispose: () => disposed.push(id),
    }),
  });

  const first = await controller.open('good');
  const failed = await controller.open('bad');
  assert.equal(first.committed, true);
  assert.equal(failed.committed, false);
  assert.equal(failed.error?.message, 'prepare failed');
  assert.equal(controller.current.id, 'good');
  assert.deepEqual(disposed, ['bad']);
});

test('transition controller reuses a warm runtime without preparing it again', async () => {
  let prepares = 0;
  const cache = createRuntimeCache();
  const controller = createTransitionController({
    cache,
    createRuntime: async (id) => createExperimentRuntime({
      id,
      prepare: async () => { prepares += 1; },
    }),
  });

  await controller.open('a');
  await controller.open('b');
  const reused = await controller.open('a');
  assert.equal(reused.committed, true);
  assert.equal(prepares, 2);
  assert.deepEqual(cache.keys(), ['b', 'a']);
});

test('transition controller shares an intent prewarm with the later open', async () => {
  let creates = 0;
  let prepares = 0;
  let compiles = 0;
  const cache = createRuntimeCache();
  const controller = createTransitionController({
    cache,
    createRuntime: async (id) => {
      creates += 1;
      return createExperimentRuntime({
        id,
        prepare: async () => { prepares += 1; },
        prepareGpu: async () => { compiles += 1; },
      });
    },
  });

  const prewarm = controller.prewarm('a');
  const opened = controller.open('a');
  const [prepared, committed] = await Promise.all([prewarm, opened]);

  assert.equal(prepared.prepared, true);
  assert.equal(committed.committed, true);
  assert.equal(creates, 1);
  assert.equal(prepares, 1);
  assert.equal(compiles, 1);
  assert.equal(controller.current.id, 'a');
});

test('equipment runtime resolves a late-created root before mount and activation', async () => {
  let root = null;
  let activated = 0;
  const runtime = createEquipmentRuntime({
    id: 'late-root',
    root: null,
    getRoot: () => root,
    prepareRoot: () => root,
    activate: () => {
      activated += 1;
      root.visible = true;
    },
  });
  root = new THREE.Group();

  await runtime.prepare({}, new AbortController().signal);
  await runtime.prepareGpu({ compileAsync: async () => {} }, new THREE.PerspectiveCamera(), null, new AbortController().signal);
  runtime.mount(new THREE.Group());
  runtime.activate({});

  assert.equal(activated, 1);
  assert.equal(root.visible, true);
  runtime.dispose();
});

test('experiment manager settles a pending start when the menu closes', async () => {
  const { createExperimentManager } = await import('../src/experiments/manager.js');
  const manager = createExperimentManager({
    equipment: { holos: {}, displays: {} },
    onHudUpdate: () => {},
    onToast: () => {},
    scheduler: {
      schedule() {},
      cancel() {},
      beginSwitchSession() {},
      cancelPrefix() {},
    },
  });

  manager.openStationMenu('electro');
  const pending = manager.startExperiment('hall_effect');
  manager.closeMenu();

  assert.equal(await pending, false);
});

test('runtime dispose is idempotent after an active session is unmounted', async () => {
  let disposed = 0;
  const runtime = createExperimentRuntime({ dispose: () => { disposed += 1; } });
  await runtime.prepare({}, new AbortController().signal);
  runtime.mount({});
  runtime.activate({});
  runtime.unmount();

  assert.equal(runtime.state, 'warm');
  assert.equal(runtime.dispose(), true);
  assert.equal(runtime.dispose(), false);
  assert.equal(runtime.state, 'cold');
  assert.equal(disposed, 1);
});

test('thermo ideal-gas runtime owns its rig and exposes a bounded pick set', async () => {
  const station = createStationEquipment({
    THREE,
    renderer: { compileAsync: async () => {} },
    camera: new THREE.PerspectiveCamera(),
    experimentClasses: { 'ideal-gas': IdealGasExperiment },
  });
  const runtime = station.equipment.createRuntime('ideal-gas');
  assert.ok(runtime);

  await runtime.prepare({}, new AbortController().signal);
  await runtime.prepareGpu({ compileAsync: async () => {} }, new THREE.PerspectiveCamera(), null, new AbortController().signal);
  assert.ok(runtime.estimateBytes().gpu > 0);
  assert.equal(runtime.getPickSet().length, 1);

  runtime.mount(station.root);
  runtime.activate({});
  assert.equal(runtime.getPickSet()[0].userData.role, 'thermo_piston');
  assert.equal(runtime.getPickSet()[0].parent?.parent, station.root);
  assert.equal(station.equipment.ensureActiveRuntime('ideal-gas'), true);

  runtime.suspend();
  assert.equal(station.root.children.length, 0);
  runtime.dispose();
  assert.equal(station.equipment.getExperimentRig('ideal-gas'), null);
  assert.equal(runtime.dispose(), false);
});

test('thermo menu showcase clears the tabletop until an experiment is selected', async () => {
  const station = createStationEquipment({
    THREE,
    renderer: { compileAsync: async () => {} },
    camera: new THREE.PerspectiveCamera(),
    experimentClasses: {
      calorimetry: CalorimetryExperiment,
      'ideal-gas': IdealGasExperiment,
    },
  });

  // Opening the station menu must not mount default calorimetry gear.
  assert.equal(station.equipment.showcase(), true);
  assert.equal(station.root.children.length, 0);
  assert.equal(station.equipment.getExperimentRig('calorimetry'), null);

  const runtime = station.equipment.createRuntime('ideal-gas');
  await runtime.prepare({}, new AbortController().signal);
  runtime.mount(station.root);
  runtime.activate({});
  assert.ok(station.root.children.length > 0);

  // Exiting / idle showcase must hide apparatus again (menu open, no card).
  assert.equal(station.equipment.showcase(), true);
  assert.equal(station.root.children.length, 0);
  runtime.dispose();
});

test('mechanics showcase clears tabletop and active runtime mounts source apparatus', async () => {
  const station = createMechanicsStationEquipment({
    THREE,
    renderer: { compileAsync: async () => {} },
    camera: new THREE.PerspectiveCamera(),
  });

  assert.equal(station.equipment.showcase(), true);
  let showcaseMeshes = 0;
  station.root.traverse((object) => {
    if (object.isMesh && object.visible) showcaseMeshes += 1;
  });
  assert.equal(showcaseMeshes, 0);

  const runtime = station.equipment.createRuntime('pendulum');
  await runtime.prepare({}, new AbortController().signal);
  runtime.mount(station.root);
  runtime.activate({});
  const sourceRoot = station.equipment.sourceRuntimes.pendulum.root;
  assert.equal(sourceRoot.parent, station.root);
  assert.equal(sourceRoot.visible, true);
  assert.ok(runtime.getPickSet().length > 0);
  runtime.dispose();
});

test('all thermo runtimes expose source-faithful pick sets and dispose idempotently', async () => {
  const classes = {
    calorimetry: CalorimetryExperiment,
    convection: ConvectionExperiment,
    'heat-conduction': HeatConductionExperiment,
    'ideal-gas': IdealGasExperiment,
    'thermal-expansion': ThermalExpansionExperiment,
  };
  const station = createStationEquipment({
    THREE,
    renderer: { compileAsync: async () => {} },
    camera: new THREE.PerspectiveCamera(),
    experimentClasses: classes,
  });
  for (const [id, minimumPickCount] of Object.entries({
    calorimetry: 2,
    convection: 1,
    'heat-conduction': 3,
    'ideal-gas': 1,
    'thermal-expansion': 2,
  })) {
    const runtime = station.equipment.createRuntime(id);
    await runtime.prepare({}, new AbortController().signal);
    await runtime.prepareGpu({ compileAsync: async () => {} }, new THREE.PerspectiveCamera(), null, new AbortController().signal);
    assert.ok(runtime.getPickSet().length >= minimumPickCount, id);
    assert.ok(runtime.getPickSet().every((object) => object.userData.interactive));
    runtime.mount(station.root);
    runtime.activate({});
    runtime.suspend();
    assert.equal(runtime.dispose(), true);
    assert.equal(runtime.dispose(), false);
  }
});

test('thermo runtimes use the shared GPU compile path without an offscreen render', async () => {
  const renderer = {
    compileCalls: 0,
    renderCalls: 0,
    async compileAsync() { this.compileCalls += 1; },
    render() { this.renderCalls += 1; },
  };
  const station = createStationEquipment({
    THREE,
    renderer,
    camera: new THREE.PerspectiveCamera(),
    experimentClasses: { 'ideal-gas': IdealGasExperiment },
  });
  const runtime = station.equipment.createRuntime('ideal-gas');

  await runtime.prepare({}, new AbortController().signal);
  await runtime.prepareGpu(renderer, new THREE.PerspectiveCamera(), new THREE.Scene(), new AbortController().signal);

  assert.equal(renderer.compileCalls, 1);
  assert.equal(renderer.renderCalls, 0);
  runtime.dispose();
});

test('manager cleanup receives the previous session snapshot', async () => {
  let cleaned = null;
  const station = {
    id: 'snapshot-station',
    experiments: [
      { id: 'a', name: 'A', steps: [] },
      { id: 'b', name: 'B', steps: [] },
    ],
  };
  const module = {
    station,
    createHandlers: ({ state }) => ({
      initData: (id) => ({ id }),
      applyVisualDefaults: () => {},
      cleanup: (_id, session) => { cleaned = session; },
      update: () => state.data,
    }),
  };
  const manager = (await import('../src/experiments/manager.js')).createExperimentManager({
    equipment: {},
    catalog: { 'snapshot-station': station },
    scheduler: {
      schedule() {},
      cancel() {},
      cancelPrefix() {},
      beginSwitchSession() {},
      scheduleChain(_id, steps) { steps.forEach((step) => step()); },
      endSoftSwitch() {},
    },
  });

  manager.registerStationModule('snapshot-station', module, station);
  manager.openStationMenu('snapshot-station');
  await manager.startExperiment('a');
  await manager.startExperiment('b');
  assert.equal(cleaned.expId, 'a');
  assert.equal(cleaned.data.id, 'a');
});
