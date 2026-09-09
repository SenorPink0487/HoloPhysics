import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers as createMechanicsHandlers, station as mechanicsStation } from '../src/experiments/mechanics.js';
import { drawHoloScreen } from '../src/holoScreen.js';

function createContext({ expId, stepId, equipment }) {
  const state = { expId, stepIndex: 0, data: {} };
  let activeStep = stepId;
  return {
    state,
    equipment,
    toast: () => {},
    pushHud: () => {},
    advanceStep: () => {},
    setStep: (id) => { activeStep = id; },
    currentStep: () => ({ id: activeStep }),
    currentExp: () => mechanicsStation.experiments.find((e) => e.id === expId),
    currentStation: () => mechanicsStation,
    get stepId() { return activeStep; },
  };
}

function createMockCanvasCtx() {
  return {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    arcTo: () => {},
    stroke: () => {},
    fill: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    measureText: () => ({ width: 40 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    set fillStyle(_) {},
    set strokeStyle(_) {},
    set lineWidth(_) {},
    set font(_) {},
    set textAlign(_) {},
    set textBaseline(_) {},
    set globalAlpha(_) {},
    set shadowColor(_) {},
    set shadowBlur(_) {},
  };
}

test('viscosity records panel toggles via UI action', () => {
  const ctx = createContext({
    expId: 'viscosity',
    stepId: 'liquid',
    equipment: {
      mechanics: {
        snapshot: () => ({ params: { liquid: 'glycerin', _records: [] }, readouts: [], paused: false }),
      },
    },
  });
  const handlers = createMechanicsHandlers(ctx);
  ctx.state.data = handlers.initData('viscosity');
  assert.equal(ctx.state.data.recordsPanelOpen, false);

  assert.equal(handlers.onUiAction('viscosity-records-panel', { open: true }), true);
  assert.equal(ctx.state.data.recordsPanelOpen, true);

  assert.equal(handlers.onUiAction('viscosity-records-panel', { open: false }), true);
  assert.equal(ctx.state.data.recordsPanelOpen, false);

  assert.equal(handlers.onUiAction('viscosity-records-panel', {}), true);
  assert.equal(ctx.state.data.recordsPanelOpen, true);
});

test('drawHoloScreen renders viscosity content screen with rich controls and hits', () => {
  const mockCtx = createMockCanvasCtx();
  const exp = mechanicsStation.experiments.find((e) => e.id === 'viscosity');

  const { hits } = drawHoloScreen(mockCtx, 1280, 1120, {
    active: true,
    surface: 'display',
    hud: {
      running: true,
      station: mechanicsStation,
      experiment: exp,
      stepIndex: 0,
      data: {
        params: {
          liquid: 'glycerin',
          temperature: 20,
          diameterMm: 2.5,
          tubeDiameterMm: 50,
          measureS: 0.2,
          timeScale: 6,
          _records: [
            { d: 2.5, dt: 0.85, v: 0.235, eta: 1.485 },
          ],
        },
        readouts: [
          { label: '流程步骤', value: '1/6 选择液体与温度' },
          { label: '液体 / 温度', value: '甘油 · 20°C' },
          { label: '位置', value: '钢球盒中' },
          { label: '速度 |v|', value: '0.00 mm/s' },
          { label: 'η 理论', value: '1.4900 Pa·s' },
          { label: 'Δt (光电门)', value: '0.850 s' },
          { label: 'v = S/Δt', value: '0.23529 m/s' },
          { label: 'η 测量', value: '1.4852 Pa·s' },
          { label: '相对误差', value: '-0.3 %' },
        ],
        recordsPanelOpen: false,
      },
    },
  });

  // Verify hit actions exist for liquid options, actions, and records panel
  const selectHits = hits.filter((h) => h.action === 'mechanics-source-select');
  assert.equal(selectHits.length, 4, 'Should have 4 liquid select chips');

  const actionHits = hits.filter((h) => h.action === 'mechanics-source-action');
  assert.ok(actionHits.some((h) => h.id === 'drop' || h.meta?.id === 'drop'), 'Should have drop ball action');
  assert.ok(actionHits.some((h) => h.id === 'record' || h.meta?.id === 'record'), 'Should have record data action');

  const panelToggleHit = hits.find((h) => h.action === 'viscosity-records-panel');
  assert.ok(panelToggleHit, 'Should have data records panel toggle button');
});

test('viscosity ball supports 3D raycaster crosshair drag and drop into cylinder', () => {
  const events = [];
  const ctx = createContext({
    expId: 'viscosity',
    stepId: 'ball',
    equipment: {
      mechanics: {
        beginBallDrag: (diameter, context) => {
          events.push(['begin', diameter, !!context.raycaster]);
          return true;
        },
        updateBallDrag: (totalX, totalY, context) => {
          events.push(['update', totalX, totalY, !!context.raycaster]);
          return true;
        },
        endBallDrag: (cancelled, context) => {
          events.push(['end', cancelled, !!context.raycaster]);
          return true;
        },
        snapshot: () => ({ params: { diameterMm: 2.5 }, readouts: [], paused: false }),
      },
    },
  });

  const handlers = createMechanicsHandlers(ctx);
  ctx.state.data = handlers.initData('viscosity');

  const fakeRaycaster = { ray: { origin: { x: 0, y: 1.2, z: 0 }, direction: { x: 0, y: -0.5, z: -1 } } };
  const target = { userData: { role: 'mechanics_viscosity_ball', diameterMm: 2.5 } };

  assert.equal(handlers.beginManipulation(target, { raycaster: fakeRaycaster }), true);
  assert.equal(handlers.updateManipulation(target, { raycaster: fakeRaycaster }), true);
  assert.equal(handlers.endManipulation(target, { raycaster: fakeRaycaster, dragged: true }), true);

  assert.deepEqual(events, [
    ['begin', 2.5, true],
    ['update', 0, 0, true],
    ['end', false, true],
  ]);
});
