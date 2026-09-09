import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameScheduler } from '../src/frameBudget.js';
import { createFrameCoordinator } from '../src/runtime/frameCoordinator.js';

test('background drain pauses when render exceeds 16.7 ms', () => {
  const events = [];
  let now = 0;
  const coordinator = createFrameCoordinator({
    now: () => now,
    onRender: () => {
      // Simulate a 20 ms present.
      now += 20;
      events.push('render');
    },
  });
  coordinator.enqueue({
    id: 'bg',
    step: () => { events.push('task'); },
  });
  now = 0;
  const result = coordinator.frame(0);
  assert.ok(result.renderMs > 16.7);
  assert.deepEqual(events, ['render']);
  assert.equal(coordinator.pending, 1);
});

test('background drain runs when render is within budget', () => {
  const events = [];
  let now = 0;
  const coordinator = createFrameCoordinator({
    now: () => now,
    onRender: () => {
      now += 4;
      events.push('render');
    },
  });
  coordinator.enqueue({
    id: 'bg',
    step: () => { events.push('task'); },
  });
  now = 0;
  coordinator.frame(0);
  assert.deepEqual(events, ['render', 'task']);
  assert.equal(coordinator.pending, 0);
});

test('frame scheduler records job timing and respects 2 ms default budget', () => {
  const timed = [];
  const scheduler = createFrameScheduler({
    budgetMs: 2,
    maxJobsPerPulse: 1,
    onJobTimed: (id, dt) => timed.push({ id, dt }),
  });
  let ran = 0;
  scheduler.schedule('exp:test', () => { ran += 1; }, { priority: 10 });
  assert.equal(scheduler.drain(2), 1);
  assert.equal(ran, 1);
  assert.equal(timed.length, 1);
  assert.equal(timed[0].id, 'exp:test');
});

test('frame coordinator breaks accumulator spiral: normal frames after a hitch run 1 step', () => {
  const fixedSteps = [];
  let now = 0;
  const coordinator = createFrameCoordinator({
    fixedDt: 1 / 60,
    maxCatchUp: 2,
    now: () => now,
    onFixedUpdate: (dt) => fixedSteps.push(dt),
  });

  // Initial frame
  coordinator.frame(0);
  assert.equal(fixedSteps.length, 0);

  // Large hitch: 100ms gap
  now = 100;
  const hitchResult = coordinator.frame(100);
  // Hit maxCatchUp (2 steps)
  assert.equal(hitchResult.steps, 2);
  assert.equal(fixedSteps.length, 2);

  // Normal subsequent frame (16.67ms later)
  now += 1000 / 60;
  const nextResult = coordinator.frame(now);
  // MUST be 1 step (no spiral of death), not 2!
  assert.equal(nextResult.steps, 1);
  assert.equal(fixedSteps.length, 3);

  // Another normal frame
  now += 1000 / 60;
  const nextResult2 = coordinator.frame(now);
  assert.equal(nextResult2.steps, 1);
  assert.equal(fixedSteps.length, 4);
});

test('frame coordinator reset clears accumulator, last timestamp, and tasks', () => {
  let steps = 0;
  let now = 0;
  const coordinator = createFrameCoordinator({
    fixedDt: 1 / 60,
    maxCatchUp: 2,
    now: () => now,
    onFixedUpdate: () => { steps += 1; },
  });

  coordinator.frame(0);
  coordinator.enqueue({ id: 'task1', step: () => {} });
  assert.equal(coordinator.pending, 1);

  // Time elapses while tab is hidden
  now = 5000;
  coordinator.reset();
  assert.equal(coordinator.pending, 0);
  assert.equal(coordinator.accumulator, 0);

  // First frame after reset starts fresh without catch-up
  const res = coordinator.frame(5000);
  assert.equal(res.steps, 0);
  assert.equal(steps, 0);
});

test('frame coordinator budget guard aborts catch-up to prevent death spiral when step is heavy', () => {
  let now = 0;
  let simTimeSpent = 10; // 10ms per sim step
  let stepsRun = 0;
  const coordinator = createFrameCoordinator({
    fixedDt: 1 / 60,
    maxCatchUp: 2,
    now: () => now,
    onFixedUpdate: () => {
      stepsRun++;
      now += simTimeSpent;
    },
    onRender: () => {
      now += 6; // 6ms render
    },
  });

  coordinator.frame(0);
  stepsRun = 0;

  // Simulate a 40ms frame (elapsed = 40ms, normally triggers 2 steps)
  // But step 1 takes 10ms + render takes 6ms = 16ms, so step 2 would breach 16.7ms!
  now = 40;
  const res = coordinator.frame(now);
  assert.equal(res.steps, 1, 'budget guard must stop at 1 step instead of causing spiral of death');
  assert.equal(stepsRun, 1);
});

test('frame coordinator epsilon tolerance prevents float jitter from causing 0-step skip', () => {
  let now = 33.333333333333336;
  let stepsRun = 0;
  const coordinator = createFrameCoordinator({
    fixedDt: 1 / 60,
    maxCatchUp: 2,
    now: () => now,
    onFixedUpdate: () => { stepsRun++; },
  });
  coordinator.frame(now);
  stepsRun = 0;

  // Next frame interval is 16.666666666666664ms, which in float arithmetic is < 1/60 by 3e-18.
  // Without epsilon tolerance, this would execute 0 steps and backlog time into subsequent frames.
  now = 50.0;
  const res = coordinator.frame(now);
  assert.equal(res.steps, 1, 'float jitter must not skip step');
  assert.equal(stepsRun, 1);
});


