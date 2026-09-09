import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INDUCED_E_R_MAX,
  inducedEDirection,
  inducedEMagnitude,
  inducedEProfile,
  inducedESense,
  inducedESenseLabel,
  inducedEVectorAt,
  createHandlers,
} from '../src/experiments/electro.js';
import { inducedEFromSliderPick } from '../src/holoScreen.js';
import { getDeskSliderConfig } from '../src/deskSliderCatalog.js';
import { STATION_EXPERIMENTS } from '../src/experiments/registry.js';

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}

function context() {
  const state = { expId: 'induced_electric_field', stepIndex: 0, data: {} };
  const mouseDrag = { holdLMB: false, movementX: 0, movementY: 0 };
  const equipment = {
    electro: {
      updateInducedElectric: () => {},
      setMode: () => {},
      mouseDrag,
    },
  };
  const handlers = createHandlers({
    state,
    equipment,
    toast: () => {},
    pushHud: () => {},
    advanceStep: () => {},
    setStep: (id) => {
      const steps = ['observe', 'probe', 'lenz', 'conclude'];
      const idx = steps.indexOf(id);
      if (idx > state.stepIndex) state.stepIndex = idx;
    },
    currentStep: () => ({ id: 'observe' }),
    currentExp: () => null,
    currentStation: () => null,
  });
  state.data = handlers.initData('induced_electric_field');
  return { state, handlers, mouseDrag };
}

test('induced electric field experiment is registered on electromagnetism station', () => {
  const experiment = STATION_EXPERIMENTS.electro.experiments.find(
    (item) => item.id === 'induced_electric_field',
  );
  assert.ok(experiment);
  assert.equal(experiment.steps.length, 4);
});

test('induced |E| is proportional to r inside the B region', () => {
  const R = 2;
  const dBdt = 1.5;
  const e1 = inducedEMagnitude(0.5, R, dBdt);
  const e2 = inducedEMagnitude(1.0, R, dBdt);
  close(e1, 0.5 * 0.5 * 1.5);
  close(e2, 0.5 * 1.0 * 1.5);
  close(e2 / e1, 2);
});

test('induced |E| falls as 1/r outside the B region', () => {
  const R = 2;
  const dBdt = 2;
  const eR = inducedEMagnitude(R, R, dBdt);
  const e2R = inducedEMagnitude(2 * R, R, dBdt);
  close(eR, 0.5 * R * 2);
  close(e2R, eR / 2);
  close(inducedEMagnitude(0, R, dBdt), 0);
});

test('Lenz sense follows the sign of dB/dt', () => {
  assert.equal(inducedESense(1), 'cw');
  assert.equal(inducedESense(-1), 'ccw');
  assert.equal(inducedESense(0), 'none');
  assert.equal(inducedESenseLabel('cw'), '顺时针（俯视 +y）');
  assert.equal(inducedESenseLabel('ccw'), '逆时针（俯视 +y）');
  assert.equal(inducedESenseLabel('none'), '无感生电场');
});

test('tangential direction is orthogonal to the radius vector', () => {
  const dir = inducedEDirection(1, 0, 'cw');
  close(dir.x * 1 + dir.z * 0, 0);
  close(Math.hypot(dir.x, dir.z), 1);
  const vec = inducedEVectorAt({ x: 1, y: 0, z: 0 }, 2, 1);
  close(vec.magnitude, inducedEMagnitude(1, 2, 1));
  close(vec.x, dir.x * vec.magnitude);
});

test('E–r profile peaks at the region boundary', () => {
  const profile = inducedEProfile(2, 1.2, 40, 4);
  assert.ok(profile.length > 10);
  let maxE = -1;
  let maxR = 0;
  profile.forEach((pt) => {
    if (pt.E > maxE) {
      maxE = pt.E;
      maxR = pt.r;
    }
  });
  close(maxR, 2, 0.15);
});

test('defaults to manual mode with static B and dB/dt', () => {
  const { state, handlers } = context();
  assert.equal(state.data.auto, false);
  close(state.data.B, 1.0);
  close(state.data.dBdt, 1.1);
  const b0 = state.data.B;
  const d0 = state.data.dBdt;
  handlers.update(0, 0.5);
  // Manual mode must not advance phase-driven values.
  close(state.data.B, b0);
  close(state.data.dBdt, d0);
});

test('controller adjusts R, flip and probe radius in manual mode', () => {
  const { state, handlers } = context();
  handlers.onUiAction('induced-e-adjust', { key: 'R', delta: 0.5 });
  assert.equal(state.data.R, 2.5);
  handlers.onUiAction('induced-e-adjust', { key: 'R', delta: 99 });
  assert.equal(state.data.R, INDUCED_E_R_MAX);
  const before = state.data.dBdt;
  handlers.onUiAction('induced-e-flip');
  // Manual flip negates dB/dt (and thus the Lenz sense).
  close(state.data.dBdt, -before);
  handlers.onUiAction('induced-e-adjust', { key: 'probeR', delta: 0.5 });
  assert.ok(state.data.probeR > 1.4);
  handlers.onUiAction('induced-e-complete');
  assert.equal(state.data.completed, true);
});

test('content-screen sliders map px to absolute parameter values', () => {
  const pick = {
    action: 'induced-e-slider',
    key: 'dBdt',
    x: 80,
    w: 440,
    trackX: 100,
    trackW: 400,
    min: -6.25,
    max: 6.25,
  };
  const lo = inducedEFromSliderPick({ ...pick, px: 100 });
  const mid = inducedEFromSliderPick({ ...pick, px: 300 });
  const hi = inducedEFromSliderPick({ ...pick, px: 500 });
  assert.equal(lo.key, 'dBdt');
  close(lo.value, -6.25);
  assert.equal(mid.key, 'dBdt');
  close(mid.value, 0);
  assert.equal(hi.key, 'dBdt');
  close(hi.value, 6.25);
  assert.equal(inducedEFromSliderPick({ ...pick }), null);
});

test('controller applies absolute slider values for R / B / dBdt / probe r', () => {
  const { state, handlers } = context();
  handlers.onUiAction('induced-e-set', { key: 'R', value: 3.0 });
  assert.equal(state.data.R, 3.0);
  handlers.onUiAction('induced-e-set', { key: 'B', value: -1.5 });
  close(state.data.B, -1.5);
  handlers.onUiAction('induced-e-slider', {
    key: 'dBdt', trackX: 0, trackW: 100, min: -6.25, max: 6.25, px: 75, live: true,
  });
  close(state.data.dBdt, -6.25 + 0.75 * 12.5, 1e-6);
  assert.equal(state.data.sliderDragging, true);
  handlers.onUiAction('induced-e-set', { key: 'probeR', value: 3.5 });
  close(state.data.probeR, 3.5, 1e-6);
  close(Math.hypot(state.data.probe.x, state.data.probe.z), 3.5, 1e-6);
});

test('content-screen slider hold continues via relative mouse drag and finishes cleanly', () => {
  const { state, handlers, mouseDrag } = context();
  handlers.beginManipulation(
    { userData: { pickFromRay: () => null } },
    {
      pick: {
        action: 'induced-e-slider',
        key: 'B',
        trackX: 0,
        trackW: 100,
        min: -2.5,
        max: 2.5,
        px: 50,
      },
      time: 0,
    },
  );
  assert.equal(state.data.sliderDragging, true);
  assert.equal(state.data.sliderKey, 'B');
  const base = state.data.B;
  mouseDrag.movementX = 80;
  handlers.holdInteract(true, 0, 0.016, null);
  assert.ok(state.data.B > base, `expected B to rise from ${base}, got ${state.data.B}`);
  handlers.holdInteract(false, 0, 0, null);
  assert.equal(state.data.sliderDragging, false);
});

test('auto loop playback drives linear change of B with constant dB/dt, and toggles field lines showE', () => {
  const { state, handlers } = context();
  assert.equal(state.data.auto, false);
  assert.equal(state.data.showE, false);
  let cfg = getDeskSliderConfig('electro', 'induced_electric_field', state.data);
  let playBtn = cfg.specs[0].buttons[0];
  assert.equal(playBtn.label, '自动变化');
  assert.equal(cfg.specs.some((s) => s.key === 'B'), false, 'desk control panel should not have 实时 B slider');
  assert.deepEqual(cfg.specs.filter((s) => s.kind === 'range').map((s) => s.key), ['R', 'dBdt']);

  const initialDbdt = state.data.dBdt;
  handlers.onUiAction('induced-e-mode', { auto: true });
  assert.equal(state.data.auto, true);
  assert.equal(state.data.showE, true);
  assert.equal(state.data.paused, false);
  cfg = getDeskSliderConfig('electro', 'induced_electric_field', state.data);
  playBtn = cfg.specs[0].buttons[0];
  assert.equal(playBtn.label, '停止');

  const b0 = state.data.B;
  handlers.update(0, 0.5);
  // B must advance linearly by dBdt * dt
  assert.ok(state.data.B > b0, `expected B to advance, was ${b0} now ${state.data.B}`);
  // dBdt must remain constant and NOT oscillate
  close(state.data.dBdt, initialDbdt, 1e-5);

  // Turning auto off freezes B and dBdt, and hides field lines
  const frozenB = state.data.B;
  const frozenD = state.data.dBdt;
  handlers.onUiAction('induced-e-mode', { auto: false });
  assert.equal(state.data.auto, false);
  assert.equal(state.data.showE, false);
  cfg = getDeskSliderConfig('electro', 'induced_electric_field', state.data);
  playBtn = cfg.specs[0].buttons[0];
  assert.equal(playBtn.label, '自动变化');

  handlers.update(0, 0.5);
  close(state.data.B, frozenB);
  close(state.data.dBdt, frozenD);
});

test('equipment disables raycast picking on forceArrow and non-probe lines/helpers', async () => {
  const { createInducedElectricFieldEquipment } = await import('../src/experiments/inducedElectricFieldEquipment.js');
  const root = createInducedElectricFieldEquipment();
  root.userData.setInteractive(true);

  root.traverse((child) => {
    if (child.userData?.role === 'induced_e_probe') {
      if (child.isMesh) {
        assert.notEqual(child.raycast.name, '', 'probe mesh should have default raycast enabled');
      }
    } else if (child.isMesh || child.isLine || child.isLineSegments || child.isSprite) {
      const hits = [];
      child.raycast({ intersectObject: () => {} }, hits);
      assert.equal(hits.length, 0, `non-probe element ${child.type} must not raycast`);
    }
  });
});

test('computeInducedFieldRingRadii increases spacing starting from the blue separator inwards and outwards', async () => {
  const { computeInducedFieldRingRadii, createInducedElectricFieldEquipment } = await import('../src/experiments/inducedElectricFieldEquipment.js');
  const R = 1.4;
  const dBdt = 2.0;
  const radii = computeInducedFieldRingRadii(R, dBdt);
  assert.ok(Array.isArray(radii) && radii.length >= 6);

  const innerRadii = radii.filter((r) => r <= R);
  const outerRadii = radii.filter((r) => r > R);

  assert.ok(innerRadii.length >= 2, 'Should have inner rings');
  assert.ok(outerRadii.length >= 2, 'Should have outer rings');

  // 1. Inward from R towards center: spacing increases
  // innerRadii is sorted ascending, so gaps between consecutive inner rings should DECREASE as r increases (meaning gap to R is smallest)
  for (let i = 0; i < innerRadii.length - 2; i += 1) {
    const gapFarFromR = innerRadii[i + 1] - innerRadii[i];
    const gapNearToR = innerRadii[i + 2] - innerRadii[i + 1];
    assert.ok(gapFarFromR > gapNearToR, `Gap near center (${gapFarFromR}) should be larger than gap near R (${gapNearToR})`);
  }

  // 2. Outward from R towards edge: spacing increases
  for (let m = 0; m < outerRadii.length - 2; m += 1) {
    const gapNearToR = outerRadii[m + 1] - outerRadii[m];
    const gapFarFromR = outerRadii[m + 2] - outerRadii[m + 1];
    assert.ok(gapFarFromR > gapNearToR, `Gap far from R (${gapFarFromR}) should be larger than gap near R (${gapNearToR})`);
  }

  // 3. Inner first offset and outer first offset match exactly (1:1 symmetric)
  const innerFirstGap = R - innerRadii[innerRadii.length - 1];
  const outerFirstGap = outerRadii[0] - R;
  assert.ok(Math.abs(innerFirstGap - outerFirstGap) < 1e-3, 'Inner and outer first gap must correspond 1:1');

  const root = createInducedElectricFieldEquipment();
  root.visible = true;
  root.userData.update({ R: 2.0, dBdt: 2.0, B: 1.0, showE: true });
  assert.equal(root.visible, true);
});

test('inner field lines have fixed spatial coordinates, expanding R reveals more lines with decreasing spacing, and outer lines adapt dynamically', async () => {
  const { computeInducedFieldRingRadii, FIXED_INNER_RADII } = await import('../src/experiments/inducedElectricFieldEquipment.js');
  const dBdt = 2.0;

  // 1. Spacing of FIXED_INNER_RADII must be strictly decreasing
  for (let i = 0; i < FIXED_INNER_RADII.length - 2; i += 1) {
    const stepA = FIXED_INNER_RADII[i + 1] - FIXED_INNER_RADII[i];
    const stepB = FIXED_INNER_RADII[i + 2] - FIXED_INNER_RADII[i + 1];
    assert.ok(stepA > stepB, `Inner step ${stepA.toFixed(3)} at index ${i} should be strictly larger than next step ${stepB.toFixed(3)}`);
  }

  // 2. Increasing R preserves the exact coordinates of previously visible inner lines (only range changes)
  const radiiR1 = computeInducedFieldRingRadii(1.2, dBdt);
  const radiiR2 = computeInducedFieldRingRadii(1.8, dBdt);
  const radiiR3 = computeInducedFieldRingRadii(2.5, dBdt);

  const in1 = radiiR1.filter((r) => r <= 1.2);
  const in2 = radiiR2.filter((r) => r <= 1.8);
  const in3 = radiiR3.filter((r) => r <= 2.5);

  assert.ok(in2.length > in1.length, 'Larger R must reveal more inner rings');
  assert.ok(in3.length > in2.length, 'Larger R must reveal more inner rings');

  // Existing inner rings must remain at identical radii without any shifting/scaling
  for (let i = 0; i < in1.length; i += 1) {
    assert.equal(in1[i], in2[i], `Inner ring ${i} must have fixed coordinate when R increases from 1.2 to 1.8`);
    assert.equal(in1[i], in3[i], `Inner ring ${i} must have fixed coordinate when R increases from 1.2 to 2.5`);
  }

  // 3. Outer rings adapt to R, and the closest inner/outer rings to divider R have matching spacing
  [1.0, 1.5, 2.0, 2.5].forEach((testR) => {
    const all = computeInducedFieldRingRadii(testR, dBdt);
    const inner = all.filter((r) => r <= testR);
    const outer = all.filter((r) => r > testR);

    assert.ok(inner.length >= 1, `Must have inner rings at R=${testR}`);
    assert.ok(outer.length >= 1, `Must have outer rings at R=${testR}`);

    const innerGap = testR - inner[inner.length - 1];
    const outerGap = outer[0] - testR;
    assert.ok(
      Math.abs(innerGap - outerGap) < 1e-3,
      `Closest inner gap (${innerGap}) and outer gap (${outerGap}) to divider at R=${testR} should match`,
    );
  });
});





