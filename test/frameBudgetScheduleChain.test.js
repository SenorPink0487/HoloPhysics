import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameScheduler } from '../src/frameBudget.js';

test('scheduleChain runs every step (soft:false open path)', () => {
  const scheduler = createFrameScheduler({ maxJobsPerPulse: 1, chainRestFrames: 1 });
  const seen = [];
  scheduler.scheduleChain('exp:switch', [
    () => { seen.push('toast'); },
    () => { seen.push('visuals'); },
    () => { seen.push('hud'); },
  ], { priority: 70, restFrames: 1, soft: false });

  // Simulate render-loop: one job per pulse, rest frames between chain steps.
  for (let i = 0; i < 30 && seen.length < 3; i += 1) {
    scheduler.tickSoftSwitch?.();
    scheduler.drain(50);
  }

  assert.deepEqual(seen, ['toast', 'visuals', 'hud'],
    'chain must complete all steps; a ReferenceError after step 0 used to hide apparatus');
});

test('scheduleChain soft:true still completes and keeps soft-switch option alive', () => {
  const scheduler = createFrameScheduler({ maxJobsPerPulse: 1 });
  const seen = [];
  scheduler.scheduleChain('exp:switch-soft', [
    () => { seen.push(1); },
    () => { seen.push(2); },
  ], { priority: 70, restFrames: 1, soft: true });

  for (let i = 0; i < 20 && seen.length < 2; i += 1) {
    scheduler.tickSoftSwitch?.();
    scheduler.drain(50);
  }

  assert.deepEqual(seen, [1, 2]);
});

test('scheduleCoop soft:false never pins soft-switch', () => {
  const scheduler = createFrameScheduler({ maxJobsPerPulse: 1 });
  let steps = 0;
  scheduler.scheduleCoop('coop-soft-false', () => {
    steps += 1;
    return steps < 3;
  }, { priority: 40, soft: false, restFrames: 1, maxPulses: 8 });

  for (let i = 0; i < 20 && steps < 3; i += 1) {
    // soft must stay off for the entire coop walk
    assert.equal(scheduler.softSwitchActive(), false, `soft active at pulse ${i}`);
    scheduler.tickSoftSwitch?.();
    scheduler.drain(50);
  }
  assert.equal(steps, 3);
  assert.equal(scheduler.softSwitchActive(), false);
});

test('startExperiment chain applies visuals after bookkeeping', async () => {
  const { createExperimentManager } = await import('../src/experiments/manager.js');

  let setModeArgs = null;
  let graphChanged = null;
  const equipment = {
    holos: {},
    displays: {},
    electro: {
      setMode(mode) { setModeArgs = mode; },
      showcase() {},
      suspend() {},
    },
  };

  const scheduler = createFrameScheduler({ maxJobsPerPulse: 1 });
  const stationPresence = {
    setHotStation(id) { return id; },
    getHotStation() { return 'electro'; },
  };

  const manager = createExperimentManager({
    equipment,
    onHudUpdate: () => {},
    onToast: () => {},
    scheduler,
    stationPresence,
    onApparatusGraphChanged: (sid) => { graphChanged = sid; },
  });

  manager.openStationMenu('electro');
  manager.startExperiment('hall_effect');

  for (let i = 0; i < 40; i += 1) {
    scheduler.tickSoftSwitch?.();
    scheduler.drain(50);
  }

  assert.equal(manager.state.running, true);
  assert.equal(manager.state.expId, 'hall_effect');
  // applyVisualDefaults for hall_effect → setMode('hall')
  assert.equal(setModeArgs, 'hall',
    'applyVisualDefaults must run so experiment apparatus becomes visible');
  assert.equal(manager.state.data?._apparatusReady, true);
  assert.equal(graphChanged, 'electro',
    'host must be notified to invalidate pick caches after mount');
});

test('setJobTimedListener receives heavy job durations', () => {
  const scheduler = createFrameScheduler({ maxJobsPerPulse: 1 });
  const seen = [];
  scheduler.setJobTimedListener((id, dt) => {
    seen.push({ id, dt });
  });
  scheduler.schedule('heavy:job', () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 5) { /* spin */ }
  }, { priority: 10 });
  scheduler.drain(50);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, 'heavy:job');
  assert.ok(seen[0].dt >= 4);
});

test('heavy soft:false job does not arm soft-switch or cooldown', () => {
  const scheduler = createFrameScheduler({
    maxJobsPerPulse: 1,
    heavyMs: 2,
    cooldownFrames: 3,
  });
  scheduler.schedule('open:heavy', () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 4) { /* spin */ }
  }, { priority: 70, soft: false });
  scheduler.drain(50);
  assert.equal(scheduler.softSwitchActive(), false);
  assert.equal(scheduler.cooldown(), 0);
  // A following job must be runnable next pulse (no rest cooldown).
  let ran = false;
  scheduler.schedule('follow', () => { ran = true; }, { priority: 1, soft: false });
  scheduler.drain(50);
  assert.equal(ran, true);
});

test('cancelPrefix removes stale progressive detail work', () => {
  const scheduler = createFrameScheduler({ maxJobsPerPulse: 1 });
  const seen = [];
  scheduler.schedule('electro:sync-detail', () => seen.push('old'), { priority: 30 });
  scheduler.schedule('electro:particles', () => seen.push('old-particles'), { priority: 30 });
  scheduler.schedule('other:keep', () => seen.push('keep'), { priority: 10 });

  scheduler.cancelPrefix('electro:');
  scheduler.drain(50);

  assert.deepEqual(seen, ['keep']);
  assert.equal(scheduler.pending(), 0);
});

test('beginSwitchSession keeps the switch camera-first until work drains', () => {
  const scheduler = createFrameScheduler({ maxJobsPerPulse: 1 });
  scheduler.beginSwitchSession();
  scheduler.schedule('exp:switch#step', () => {}, { priority: 70, soft: false });
  assert.equal(scheduler.softSwitchActive(), true);
  scheduler.drain(50);
  for (let i = 0; i < 16; i += 1) scheduler.tickSoftSwitch();
  assert.equal(scheduler.softSwitchActive(), false);
});
