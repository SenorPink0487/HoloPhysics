import assert from 'node:assert/strict';
import test from 'node:test';

import { createHandlers } from '../src/experiments/electro.js';
import { drawHoloScreen, getHoloScreenLayoutSize } from '../src/holoScreen.js';

function createMockCtx() {
  return {
    save: () => {}, restore: () => {}, clearRect: () => {}, fillRect: () => {}, strokeRect: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, arc: () => {}, arcTo: () => {},
    closePath: () => {}, fill: () => {}, stroke: () => {}, fillText: () => {}, strokeText: () => {},
    measureText: (text) => ({ width: (text || '').length * 10 }),
    setLineDash: () => {}, createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }), clip: () => {},
    scale: () => {}, translate: () => {},
  };
}

function createHallContext() {
  const state = { expId: 'hall_effect', stepIndex: 0, data: {} };
  const equipment = {
    electro: {
      updateHall: () => {},
      mouseDrag: { holdLMB: false, movementX: 0, movementY: 0 },
    },
  };
  const handlers = createHandlers({
    state,
    equipment,
    toast: () => {},
    pushHud: () => {},
    advanceStep: () => {},
    setStep: () => {},
    currentStep: () => ({ id: 'compare' }),
    currentExp: () => null,
    currentStation: () => null,
  });
  state.data = handlers.initData('hall_effect');
  // Wire up power supply to solenoid
  state.data.wires = [
    { from: 'out_red', to: 'sol_red', color: '#ef4444' },
    { from: 'out_black', to: 'sol_black', color: '#1e293b' },
  ];
  handlers.onUiAction('hall-set', { key: 'Im', value: 0.5 });
  handlers.onUiAction('hall-set', { key: 'Is', value: 0.005 });
  return { state, handlers };
}

test('Hall effect solenoid data points match theoretical fitted curve across all probe positions', () => {
  const { state, handlers } = createHallContext();

  // Test across range X = 1.0 to 31.0 cm
  for (let x = 1.0; x <= 31.0; x += 1.0) {
    handlers.onUiAction('hall-set', { key: 'probePos', value: x });
    handlers.onUiAction('hall-record');
  }

  assert.equal(state.data.records.length, 31);

  // Enable curve and fit
  handlers.onUiAction('hall-chart');
  handlers.onUiAction('hall-fit');
  assert.equal(state.data.showCurve, true);
  assert.equal(state.data.showFit, true);

  const mockCtx = createMockCtx();
  const layout = getHoloScreenLayoutSize('hall_effect', state.data, false);
  assert.ok(layout.width > 0 && layout.height > 0);

  // Drawing the screen with curve and points should execute without error
  const res = drawHoloScreen(mockCtx, 1024, 768, {
    active: true,
    expId: 'hall_effect',
    data: state.data,
    hud: { expId: 'hall_effect', data: state.data },
  });
  assert.ok(res?.hits?.length > 0);

  // Verify symmetry of B values around center (X = 16.0 cm)
  const bAt1 = state.data.records.find((r) => Math.abs(r.pos - 1.0) < 0.1).b;
  const bAt31 = state.data.records.find((r) => Math.abs(r.pos - 31.0) < 0.1).b;
  const bAt16 = state.data.records.find((r) => Math.abs(r.pos - 16.0) < 0.1).b;

  assert.ok(Math.abs(bAt1 - bAt31) < 1e-7, 'Solenoid magnetic field must be symmetric at both ends');
  assert.ok(bAt16 > bAt1, 'Center field must be greater than end field');
  // At the ends, B should be approximately half of center field
  assert.ok(Math.abs(bAt1 - bAt16 / 2) < 0.0001, 'End field should be approx half center field');
});

test('Hall effect Helmholtz coil data points match theoretical curve', () => {
  const { state, handlers } = createHallContext();

  handlers.onUiAction('hall-target', { target: 'helmholtz' });
  state.data.wires = [
    { from: 'out_red', to: 'hh_red', color: '#ef4444' },
    { from: 'out_black', to: 'hh_black', color: '#1e293b' },
  ];
  handlers.onUiAction('hall-set', { key: 'Im', value: 0.5 });
  handlers.onUiAction('hall-set', { key: 'Is', value: 0.005 });
  handlers.onUiAction('hall-set', { key: 'rightCoilPos', value: 0.05 });

  for (let x = -0.04; x <= 0.09; x += 0.01) {
    handlers.onUiAction('hall-set', { key: 'probePos', value: x });
    handlers.onUiAction('hall-record');
  }

  assert.ok(state.data.records.length >= 10);
  handlers.onUiAction('hall-chart');
  handlers.onUiAction('hall-fit');

  const mockCtx = createMockCtx();
  const res = drawHoloScreen(mockCtx, 1024, 768, {
    active: true,
    expId: 'hall_effect',
    data: state.data,
    hud: { expId: 'hall_effect', data: state.data },
  });
  assert.ok(res?.hits?.length > 0);
});
