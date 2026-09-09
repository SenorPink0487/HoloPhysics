import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimDriver } from '../src/runtime/simDriver.js';
import { createFrameCoordinator } from '../src/runtime/frameCoordinator.js';
import { createExperimentManager } from '../src/experiments/manager.js';

test('SimDriver fixedUpdate runs simulate when active', () => {
  const steps = [];
  const driver = createSimDriver();
  driver.bind({
    simulate: (dt) => {
      steps.push(dt);
      return { ok: true, dt };
    },
    isActive: () => true,
  });

  const out = driver.fixedUpdate(1 / 60);
  assert.equal(out.skipped, false);
  assert.equal(steps.length, 1);
  assert.equal(steps[0], 1 / 60);
  assert.equal(driver.fixedTicks, 1);
  assert.equal(driver.lastResult.ok, true);
  driver.dispose();
});

test('SimDriver pause skips simulate but keeps binding', () => {
  let calls = 0;
  const driver = createSimDriver();
  driver.bind({
    simulate: () => { calls += 1; return true; },
    isActive: () => true,
  });
  driver.pause();
  const out = driver.fixedUpdate(1 / 60);
  assert.equal(out.skipped, true);
  assert.equal(calls, 0);
  driver.resume();
  driver.fixedUpdate(1 / 60);
  assert.equal(calls, 1);
  driver.dispose();
});

test('SimDriver inactive when isActive is false', () => {
  let calls = 0;
  const driver = createSimDriver();
  driver.bind({
    simulate: () => { calls += 1; },
    isActive: () => false,
  });
  const out = driver.fixedUpdate(0.01);
  assert.equal(out.skipped, true);
  assert.equal(calls, 0);
  driver.dispose();
});

test('FrameCoordinator drives SimDriver fixed steps', () => {
  const seen = [];
  const driver = createSimDriver();
  driver.bind({
    simulate: (dt) => { seen.push(dt); },
    isActive: () => true,
  });
  let presents = 0;
  const coord = createFrameCoordinator({
    fixedDt: 1 / 60,
    maxCatchUp: 2,
    onFixedUpdate: (dt) => driver.fixedUpdate(dt),
    onRender: () => { presents += 1; },
  });

  // ~2 fixed steps of time
  coord.frame(0);
  coord.frame(1000 / 30); // ~33ms → 2 steps at 60Hz
  assert.ok(seen.length >= 1);
  assert.equal(presents, 2);
  driver.dispose();
});

test('experiment manager fixedUpdate re-homes handler.update when owned by driver', () => {
  let integrateCalls = 0;
  let syncCalls = 0;
  const manager = createExperimentManager({
    equipment: {},
    catalog: {
      mechanics: {
        id: 'mechanics',
        title: '力学',
        experiments: [{ id: 'free-fall', name: '自由落体', steps: [] }],
      },
    },
  });

  manager.registerStationModule('mechanics', {
    createHandlers: () => ({
      update(_t, dt) {
        integrateCalls += 1;
        return { dt };
      },
      syncState() {
        syncCalls += 1;
        return { synced: true };
      },
      cleanup() {},
    }),
  });

  // Manually mark running so update/fixedUpdate execute.
  manager.state.running = true;
  manager.state.stationId = 'mechanics';
  manager.state.expId = 'free-fall';

  manager.setSimOwnedByDriver(true);
  const light = manager.update(0, 0.016, { simulate: false });
  assert.equal(integrateCalls, 0);
  assert.equal(syncCalls, 1);
  assert.equal(light.synced, true);

  manager.fixedUpdate(1 / 60);
  assert.equal(integrateCalls, 1);
  assert.ok(manager.state._dt > 0);
});

test('continuous Faraday slider drag skips duplicate absolute values', async () => {
  const calls = [];
  const manager = createExperimentManager({
    equipment: {},
    catalog: {
      electro: {
        id: 'electro',
        title: '电磁学',
        experiments: [{ id: 'faraday_induction', name: '法拉第电磁感应', steps: [] }],
      },
    },
  });
  manager.registerStationModule('electro', {
    createHandlers: ({ state }) => ({
      initData: () => ({ value: 0 }),
      beginManipulation: () => true,
      onUiAction(action, payload) {
        if (action !== 'faraday-b-set') return false;
        state.data.value = payload.value;
        calls.push(payload.value);
        return true;
      },
      cleanup() {},
    }),
  });
  manager.state.stationId = 'electro';
  manager.state.expId = 'faraday_induction';
  manager.state.running = true;
  manager.state.data = { value: 0 };

  const firstPick = {
    action: 'faraday-b-slider',
    value: 1.25,
    min: -3,
    max: 3,
    key: 'B',
  };
  const host = { userData: {} };
  assert.equal(manager.beginManipulation(host, { pick: firstPick }), true);
  assert.equal(manager.updateManipulation(host, { totalX: 0 }), true);
  assert.equal(manager.updateManipulation(host, { totalX: 0 }), true);
  assert.deepEqual(calls, []);

  assert.equal(manager.updateManipulation(host, { totalX: 25 }), true);
  assert.equal(calls.length, 1);
  assert.equal(manager.updateManipulation(host, { totalX: 25 }), true);
  assert.equal(calls.length, 1);
});
