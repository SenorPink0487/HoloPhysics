import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHandlers,
  diffractionEnvelopeZeros,
  diffractionHalfSpan,
  diffractionIntensity,
  diffractionPrincipalMaxima,
  formatOpticsRecordCell,
  opticsRecordColumns,
} from '../src/experiments/optics.js';

function createContext() {
  const toasts = [];
  const ctx = {
    state: {
      stationId: 'optics',
      expId: 'multi_slit_diffraction',
      stepIndex: 0,
      running: true,
      data: {},
    },
    equipment: { optics: { updateOptics: () => {}, setMode: () => {}, clearIdentifyVisuals: () => {} } },
    toast: (m) => toasts.push(m),
    pushHud: () => {},
    setStep: (id) => {
      const steps = ['setup', 'observe', 'measure', 'curve', 'result'];
      const idx = steps.indexOf(id);
      if (idx >= 0) ctx.state.stepIndex = idx;
    },
    currentStep: () => {
      const steps = [
        { id: 'setup' }, { id: 'observe' }, { id: 'measure' }, { id: 'curve' }, { id: 'result' },
      ];
      return steps[ctx.state.stepIndex] || null;
    },
    toasts,
  };
  return ctx;
}

test('diffraction intensity peaks at center and envelope zeros near m λL/a', () => {
  const data = { lambdaNm: 550, slitMm: 0.1, pitchMm: 0.25, N: 1, distM: 1 };
  assert.ok(diffractionIntensity(0, data) > 0.99);
  const half = diffractionHalfSpan(data);
  const zeros = diffractionEnvelopeZeros(data, half);
  assert.ok(zeros.length >= 1);
  const x1 = zeros[0].x;
  // At envelope zero, single-slit factor vanishes
  assert.ok(diffractionIntensity(x1, data) < 0.02);
});

test('principal maxima spacing matches Δx = λL/d for double slit', () => {
  const data = { lambdaNm: 550, slitMm: 0.05, pitchMm: 0.25, N: 2, distM: 1 };
  const half = diffractionHalfSpan(data);
  const maxima = diffractionPrincipalMaxima(data, half);
  assert.ok(maxima.some((m) => m.p === 0 && m.x === 0));
  const p1 = maxima.find((m) => m.p === 1);
  assert.ok(p1);
  const expected = (550e-9 * 1) / (0.25e-3);
  assert.ok(Math.abs(p1.x - expected) < 1e-9);
  // Intensity at principal max should be high relative to mid-fringe
  const mid = p1.x / 2;
  assert.ok(diffractionIntensity(p1.x, data) > diffractionIntensity(mid, data));
});

test('N=1 has no multi-slit principal maxima list', () => {
  const data = { lambdaNm: 550, slitMm: 0.1, pitchMm: 0.25, N: 1, distM: 1 };
  assert.deepEqual(diffractionPrincipalMaxima(data), []);
});

test('optics record writes comparison row without opening panel', () => {
  const ctx = createContext();
  const handlers = createHandlers(ctx);
  ctx.state.data = handlers.initData('multi_slit_diffraction');
  assert.equal(ctx.state.data.recordsPanelOpen, false);
  assert.equal(ctx.state.data.chartOpen, false);

  assert.equal(handlers.onUiAction('optics-diff-record'), true);
  assert.equal(ctx.state.data.records.length, 1);
  assert.equal(ctx.state.data.recordsPanelOpen, false);
  const row = ctx.state.data.records[0];
  assert.ok(Number(row.fringeSpacingMm) > 0);
  assert.ok(Number(row.centralWidthMm) > 0);
  assert.equal(typeof row.farField, 'boolean');
  assert.ok(ctx.toasts.some((t) => t.includes('对照') && t.includes('Δx')));
});

test('optics chart open annotates and closes records panel if open', () => {
  const ctx = createContext();
  const handlers = createHandlers(ctx);
  ctx.state.data = handlers.initData('multi_slit_diffraction');
  handlers.onUiAction('optics-diff-record');
  handlers.onUiAction('optics-diff-records-panel', { open: true });
  assert.equal(ctx.state.data.recordsPanelOpen, true);

  assert.equal(handlers.onUiAction('optics-diff-chart'), true);
  assert.equal(ctx.state.data.chartOpen, true);
  assert.equal(ctx.state.data.recordsPanelOpen, false);
  assert.ok(ctx.toasts.some((t) => t.includes('核对') || t.includes('主极大') || t.includes('包络')));

  handlers.onUiAction('optics-diff-chart');
  assert.equal(ctx.state.data.chartOpen, false);
});

test('optics complete requires at least one comparison row', () => {
  const ctx = createContext();
  const handlers = createHandlers(ctx);
  ctx.state.data = handlers.initData('multi_slit_diffraction');
  assert.equal(handlers.onUiAction('optics-diff-complete'), true);
  assert.equal(ctx.state.data.completed, false);

  handlers.onUiAction('optics-diff-record');
  handlers.onUiAction('optics-diff-complete');
  assert.equal(ctx.state.data.completed, true);
  assert.equal(ctx.state.data.recordsPanelOpen, false);
  assert.equal(ctx.state.data.chartOpen, false);
});

test('optics record columns format cells for comparison table', () => {
  const cols = opticsRecordColumns();
  assert.ok(cols.some((c) => c.key === 'fringeSpacingMm'));
  const row = {
    N: 2,
    lambdaNm: 632.8,
    slitMm: 0.05,
    pitchMm: 0.3,
    distM: 1,
    fringeSpacingMm: 2.109,
    centralWidthMm: 25.31,
    farField: true,
  };
  assert.equal(formatOpticsRecordCell(row, '#', 0), '1');
  assert.equal(formatOpticsRecordCell(row, 'N'), '2');
  assert.equal(formatOpticsRecordCell(row, 'farField'), '是');
  assert.equal(formatOpticsRecordCell({ ...row, farField: false }, 'farField'), '近场');
});

test('drawHoloScreen renders diffraction experiment layout without crashing and produces expected hits', async () => {
  const { drawHoloScreen, getHoloScreenLayoutSize } = await import('../src/holoScreen.js');
  const experiment = {
    id: 'multi_slit_diffraction',
    name: '单缝衍射 · 多缝干涉',
    steps: [
      { id: 'setup', text: '点亮激光器并选择预设' },
      { id: 'observe', text: '观察屏上条纹与曲线' },
    ],
  };
  const hud = {
    running: true,
    stepIndex: 0,
    experiment,
    data: {
      lambdaNm: 550,
      slitMm: 0.1,
      pitchMm: 0.25,
      N: 1,
      distM: 1,
      fringeSpacingMm: 2.2,
      centralWidthMm: 22,
      fresnel: 0.018,
      farField: true,
      lightOn: true,
      records: [],
    },
  };

  const stubCtx = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    stroke() {},
    fill() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    measureText: () => ({ width: 40 }),
    clearRect() {},
    setLineDash() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  };

  const size = getHoloScreenLayoutSize('display', hud, true, experiment);
  assert.ok(size.width > 0 && size.height > 0);

  const res = drawHoloScreen(stubCtx, size.width, size.height, {
    active: true,
    hud,
    surface: 'display',
    accentHex: '#38bdf8',
  });

  assert.ok(res.hits.length > 0);
  assert.ok(res.hits.some((h) => h.action === 'optics-diff-preset'));
  assert.ok(res.hits.some((h) => h.action === 'optics-diff-power'));
  assert.ok(res.hits.some((h) => h.action === 'optics-diff-record'));
  assert.ok(res.hits.some((h) => h.action === 'optics-diff-chart'));
  assert.ok(res.hits.some((h) => h.action === 'optics-diff-records-panel'));
});

