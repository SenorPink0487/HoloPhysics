import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenTiming } from '../src/runtime/openTiming.js';

test('begin/mark/end records phase deltas', () => {
  const ot = createOpenTiming();
  ot.begin('experiment', { stationId: 'optics', expId: 'reflection' });
  ot.mark('setHotStation', { dtMs: 0.2 });
  ot.mark('initData', { dtMs: 0.1 });
  const snap = ot.end({ phase: 'mounted' });
  assert.equal(snap.kind, 'experiment');
  assert.equal(snap.meta.expId, 'reflection');
  assert.ok(snap.totalMs != null);
  assert.ok(snap.marks.some((m) => m.name === 'setHotStation'));
  assert.ok(snap.marks.some((m) => m.name === 'end'));
  assert.equal(ot.getLast()?.id, snap.id);
});

test('recordJob ignores tiny jobs and keeps heavy ones', () => {
  const ot = createOpenTiming();
  ot.begin('experiment', { expId: 'x' });
  ot.recordJob('hud:paint', 1.2);
  ot.recordJob('exp:switch#step', 12.5);
  const snap = ot.end();
  assert.equal(snap.jobs.length, 1);
  assert.equal(snap.jobs[0].id, 'exp:switch#step');
  assert.ok(snap.topJobs[0].dt >= 12);
});

test('nested begin abandons prior session', () => {
  const ot = createOpenTiming();
  ot.begin('station-menu', { stationId: 'optics' });
  ot.begin('experiment', { expId: 'reflection' });
  const sessions = ot.getSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].kind, 'station-menu');
  assert.ok(sessions[0].marks.some((m) => m.name === 'abandoned'));
  ot.end();
  assert.equal(ot.getSessions().length, 2);
});
