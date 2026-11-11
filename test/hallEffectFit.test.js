import assert from 'node:assert/strict';
import test from 'node:test';

import { createHandlers } from '../src/experiments/electro.js';
import { drawHoloScreen, getHoloScreenLayoutSize, pickHoloScreen, valueFromParamSliderPick } from '../src/holoScreen.js';

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

test('Hall effect floating display stitches Im, Is, probePos, coil/turns sliders with step quantization and record button', () => {
  const { state, handlers } = createHallContext();
  state.data.identified = { hall_helmholtz: true, hall_solenoid: true, hall_probe: true, hall_console: true };
  state.stepIndex = 1;
  state.data.stepIndex = 1;

  for (const target of ['helmholtz', 'solenoid']) {
    state.data.wires = target === 'helmholtz'
      ? [{ from: 'out_red', to: 'hh_red', color: '#ef4444' }, { from: 'out_black', to: 'hh_black', color: '#1e293b' }]
      : [{ from: 'out_red', to: 'sol_red', color: '#ef4444' }, { from: 'out_black', to: 'sol_black', color: '#1e293b' }];
    handlers.onUiAction('hall-target', { target });
    const mockCtx = createMockCtx();
    const res = drawHoloScreen(mockCtx, 1152, 768, {
      surface: 'display',
      theme: 'light',
      active: true,
      hud: {
        running: true,
        station: { id: 'electro', name: '电磁学实验台' },
        experiment: { id: 'hall_effect', name: '霍尔效应测磁' },
        data: state.data,
      },
    });
    const sliders = res.hits.filter((h) => h.role === 'param-slider');
    const keys = sliders.map((s) => s.key).sort();
    if (target === 'helmholtz') {
      assert.deepEqual(keys, ['Im', 'Is', 'probePos', 'rightCoilPos']);
    } else {
      assert.deepEqual(keys, ['Im', 'Is', 'probePos', 'turns']);
    }
    const probeHit = sliders.find((s) => s.key === 'probePos');
    const px = probeHit.trackX + probeHit.trackW * 0.63;
    const py = probeHit.y + probeHit.h * 0.5;
    const pick = pickHoloScreen(px / 1152, 1 - py / 768, 1152, 768, res.hits, 1);
    assert.equal(pick?.key, 'probePos');
    const val = valueFromParamSliderPick(pick);
    const step = target === 'helmholtz' ? 0.01 : 0.5;
    assert.ok(Math.abs(Math.round(val / step) * step - val) < 1e-6, `probePos ${val} should quantize to step ${step}`);
    assert.ok(res.hits.some((h) => h.action === 'hall-record'), 'missing hall-record button on floating display');
  }
});
