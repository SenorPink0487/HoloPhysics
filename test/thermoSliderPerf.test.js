import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../src/experiments/thermo.js';

function context(expId = 'ideal-gas') {
  const state = { expId, stepIndex: 0, data: {}, running: true };
  let hudCount = 0;
  let updateCount = 0;
  const equipment = {
    thermo: {
      updateState: () => { updateCount += 1; },
      setMode: () => {},
      reset: () => {},
    },
  };
  const handlers = createHandlers({
    state,
    equipment,
    toast: () => {},
    pushHud: () => { hudCount += 1; },
    advanceStep: () => {},
    setStep: () => {},
    currentStep: () => ({ id: 'set_temperature' }),
    currentExp: () => null,
    currentStation: () => null,
  });
  state.data = handlers.initData(expId);
  return {
    state,
    handlers,
    hudCount: () => hudCount,
    updateCount: () => updateCount,
  };
}

test('thermo live slider drags throttle HUD repaints', () => {
  const { handlers, hudCount, updateCount } = context('ideal-gas');
  // First live event always paints (liveSliderHudAt starts at 0).
  assert.equal(handlers.onUiAction('thermo-set', { key: 'temperature', value: 310, live: true }), true);
  const hudAfterFirst = hudCount();
  assert.ok(hudAfterFirst >= 1);
  const updatesAfterFirst = updateCount();

  // Burst of live events that all quantize to the same integer → no extra 3D work.
  for (let i = 0; i < 20; i += 1) {
    handlers.onUiAction('thermo-set', { key: 'temperature', value: 310.1 + i * 0.01, live: true });
  }
  assert.equal(updateCount(), updatesAfterFirst, 'quantized identical values should skip updateState');
  // HUD must not repaint on every pointer sample.
  assert.ok(hudCount() <= hudAfterFirst + 2, `expected throttled HUD, got ${hudCount()}`);
});

test('thermo discrete set still pushes HUD immediately', () => {
  const { handlers, state, hudCount } = context('convection');
  const before = hudCount();
  handlers.onUiAction('thermo-set', { key: 'tPlate', value: 720 });
  assert.equal(state.data.tPlate, 720);
  assert.equal(hudCount(), before + 1);
});

test('thermo volume quantizes to two decimals while dragging', () => {
  const { handlers, state } = context('ideal-gas');
  handlers.onUiAction('thermo-set', { key: 'volume', value: 0.876543, live: true });
  assert.equal(state.data.volume, 0.88);
});
