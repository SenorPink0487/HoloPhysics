import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceGovernor } from '../src/runtime/performanceGovernor.js';

test('performanceGovernor creates initial snapshot with default quality profile', () => {
  const gov = createPerformanceGovernor();
  const snapshot = gov.getSnapshot();

  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.quality.particleBudget, 20000);
  assert.equal(typeof snapshot.fps, 'number');
  assert.equal(typeof snapshot.frameMs, 'number');
  gov.dispose();
});

test('performanceGovernor records frame intervals and computes smoothed fps', () => {
  const gov = createPerformanceGovernor();
  
  // Simulate 16 frames spaced at 16.67ms (total ~266ms, crossing the 250ms window)
  let t = 1000;
  for (let i = 0; i < 16; i += 1) {
    gov.beginFrame(t);
    gov.recordSimulation(2.0);
    gov.recordRender(5.0);
    t += 16.666;
    gov.endFrame(t);
  }

  const snapshot = gov.getSnapshot();
  // 16 frames in ~266.6ms => ~60 fps
  assert.ok(snapshot.fps >= 58 && snapshot.fps <= 62, `expected ~60 fps, got ${snapshot.fps}`);
  assert.ok(snapshot.frameMs > 0, `expected positive frameMs, got ${snapshot.frameMs}`);
  assert.equal(snapshot.renderMs, 5.0);
  assert.equal(snapshot.simulationMs, 2.0);
  gov.dispose();
});

test('performanceGovernor tracks pressure and warns on sustained slow frames', () => {
  let warned = false;
  const gov = createPerformanceGovernor({
    onStatusChange(status) {
      if (status === 'warning') warned = true;
    },
  });

  // Simulate multiple consecutive slow frames (> 16.7ms frameMs)
  let t = 1000;
  for (let i = 0; i < 6; i += 1) {
    gov.beginFrame(t);
    t += 30; // 30ms single frame
    gov.endFrame(t);
  }

  assert.equal(warned, true);
  gov.dispose();
});

test('performanceGovernor reports throttled when fps is low but cpu load is low', () => {
  const gov = createPerformanceGovernor();

  // Simulate 8 frames spaced at 33.3ms (total ~266ms => ~30 fps) with fast 2ms execution
  let t = 1000;
  for (let i = 0; i < 8; i += 1) {
    gov.beginFrame(t);
    gov.recordSimulation(1.0);
    gov.recordRender(1.0);
    gov.endFrame(t + 2);
    t += 33.333;
  }

  const snapshot = gov.getSnapshot();
  assert.ok(snapshot.fps < 50, `expected low fps, got ${snapshot.fps}`);
  assert.equal(snapshot.status, 'throttled');
  gov.dispose();
});
