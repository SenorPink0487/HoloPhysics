import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FARADAY_ROD_LENGTH,
  faradayArea,
  faradayEmfFromDelta,
  faradayFlux,
  faradaySense,
  createHandlers,
} from '../src/experiments/electro.js';
import { faradayBFromSliderPick } from '../src/holoScreen.js';
import { getDeskSliderConfig } from '../src/deskSliderCatalog.js';
import { STATION_EXPERIMENTS } from '../src/experiments/registry.js';
import { createStationEquipment as createElectroEquipment } from '../src/scene/stations/electro.js';
import * as THREE from 'three';

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}

function faradayContext() {
  const state = { expId: 'faraday_induction', stepIndex: 0, data: {} };
  const mouseDrag = { holdLMB: false, movementX: 0, movementY: 0 };
  const equipment = {
    electro: {
      updateFaraday: () => {},
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
      const steps = ['motion', 'field', 'conclude'];
      const idx = steps.indexOf(id);
      if (idx > state.stepIndex) state.stepIndex = idx;
    },
    currentStep: () => ({ id: 'motion' }),
    currentExp: () => null,
    currentStation: () => null,
  });
  state.data = handlers.initData('faraday_induction');
  return { state, handlers, mouseDrag };
}

test('Faraday apparatus is registered on the electromagnetism station', () => {
  const experiment = STATION_EXPERIMENTS.electro.experiments.find((item) => item.id === 'faraday_induction');
  assert.ok(experiment);
  assert.equal(experiment.steps.length, 3);
});

test('Faraday flux uses B times the sliding-rod area', () => {
  assert.equal(faradayArea(4.5), (4.5 - 0.25) * FARADAY_ROD_LENGTH);
  assert.equal(faradayFlux(-1, 4.5), -17);
  assert.equal(faradayFlux(0, 4.5), 0);
});

test('Faraday emf and Lenz direction obey sign and limiting cases', () => {
  assert.equal(faradayEmfFromDelta(2, 0.5), -4);
  assert.equal(faradaySense(1), 'cw');
  assert.equal(faradaySense(-1), 'ccw');
  assert.equal(faradaySense(0), 'none');
  assert.equal(faradayEmfFromDelta(0, 1), -0);
});

test('content-screen Faraday slider pick maps canvas px to B', () => {
  const pick = {
    action: 'faraday-b-slider',
    x: 100,
    w: 400,
    min: -3,
    max: 3,
  };
  assert.equal(faradayBFromSliderPick({ ...pick, px: 100 }), -3);
  assert.equal(faradayBFromSliderPick({ ...pick, px: 300 }), 0);
  assert.equal(faradayBFromSliderPick({ ...pick, px: 500 }), 3);
  assert.equal(faradayBFromSliderPick({ ...pick }), null);
});

test('Faraday defaults expose target B/x and duration for preset-then-play', () => {
  const { state } = faradayContext();
  assert.equal(state.data.animChannel, 'B');
  assert.ok(Number.isFinite(state.data.targetB));
  assert.ok(Number.isFinite(state.data.targetX));
  assert.ok(state.data.animDuration >= 0.3);
  assert.equal(state.data.pendingAnim, null);
});

test('Faraday animates B from current to target and records induction', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-set', { key: 'B', value: -1 });
  handlers.onUiAction('faraday-set', { key: 'targetB', value: 2 });
  handlers.onUiAction('faraday-set', { key: 'animDuration', value: 1 });
  handlers.onUiAction('faraday-channel', { channel: 'B' });
  handlers.onUiAction('faraday-play', {});
  assert.ok(state.data.pendingAnim);
  assert.equal(state.data.pendingAnim.channel, 'B');
  close(state.data.pendingAnim.from, -1);
  close(state.data.pendingAnim.to, 2);

  // Advance through the smoothstep animation.
  for (let i = 0; i < 30; i += 1) handlers.update(0, 0.05);
  assert.equal(state.data.pendingAnim, null);
  close(state.data.B, 2, 1e-5);
  assert.ok(state.data.lastInduction);
  close(state.data.lastInduction.B0, -1, 1e-5);
  close(state.data.lastInduction.B1, 2, 1e-5);
  assert.ok(Math.abs(state.data.lastInduction.emf) > 0);
});

test('Faraday animates x from current to target and records motion', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-set', { key: 'x', value: 3 });
  handlers.onUiAction('faraday-set', { key: 'targetX', value: 7 });
  handlers.onUiAction('faraday-set', { key: 'animDuration', value: 0.8 });
  handlers.onUiAction('faraday-channel', { channel: 'x' });
  handlers.onUiAction('faraday-play', {});
  assert.ok(state.data.pendingAnim);
  assert.equal(state.data.pendingAnim.channel, 'x');

  for (let i = 0; i < 30; i += 1) handlers.update(0, 0.05);
  assert.equal(state.data.pendingAnim, null);
  close(state.data.x, 7, 1e-5);
  assert.ok(state.data.lastMotion);
  close(state.data.lastMotion.x0, 3, 1e-5);
  close(state.data.lastMotion.x1, 7, 1e-5);
});

test('Faraday reverse B is a dynamic change to −B', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-set', { key: 'B', value: 1.2 });
  handlers.onUiAction('faraday-reverse', {});
  assert.ok(state.data.pendingAnim);
  close(state.data.pendingAnim.to, -1.2, 1e-6);
  for (let i = 0; i < 40; i += 1) handlers.update(0, 0.05);
  close(state.data.B, -1.2, 1e-5);
  assert.ok(state.data.lastInduction);
});

test('live faraday-set x drag arms motional current while x changes', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-set', { key: 'B', value: -1 });
  handlers.onUiAction('faraday-set', { key: 'x', value: 3 });
  // Live desk/content drag: begin motion measurement + update x.
  assert.equal(
    handlers.onUiAction('faraday-set', { key: 'x', value: 5, live: true }),
    true,
  );
  assert.equal(state.data.dragging, true);
  assert.ok(state.data.motionStart);
  close(state.data.x, 5);
  // One frame of velocity → non-zero emf / Lenz sense.
  handlers.update(0, 0.05);
  assert.notEqual(state.data.currentSense, 'none');
  assert.ok(Math.abs(state.data.liveEmf) > 1e-6);
  // Release finishes the motion record (same path as rod drag).
  handlers.endManipulation?.(null, { time: state.data._time });
  assert.equal(state.data.dragging, false);
  assert.ok(state.data.lastMotion);
  close(state.data.lastMotion.x0, 3, 1e-5);
  close(state.data.lastMotion.x1, 5, 1e-5);
});

test('AR rod drag synchronizes induction direction before the next fixed tick', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-set', { key: 'B', value: -1 });
  const rod = { userData: { role: 'faraday_rod' } };
  assert.equal(handlers.beginManipulation(rod, { time: 0 }), true);
  assert.equal(handlers.updateManipulation(rod, { totalX: 80, dt: 1 / 30, dragged: true }), true);
  assert.notEqual(state.data.currentSense, 'none');
  assert.ok(Math.abs(state.data.liveEmf) > 1e-6);
  const forwardSense = state.data.currentSense;
  assert.equal(
    handlers.updateManipulation(rod, { totalX: 79, dt: 1 / 30, dragged: true }),
    true,
  );
  assert.equal(state.data.currentSense, forwardSense, 'one-pixel reverse jitter does not flip current');
  assert.equal(
    handlers.updateManipulation(rod, { totalX: 70, dt: 1 / 30, dragged: true }),
    true,
  );
  assert.notEqual(state.data.currentSense, forwardSense, 'a deliberate reverse drag flips current');
  handlers.update(0, 1 / 60);
  const direction = state.data.currentSense;
  handlers.update(0, 1 / 60);
  assert.equal(state.data.currentSense, direction, 'direction persists between sparse hand samples');
  assert.ok(state.data.currentLinger > 0);
});

test('live faraday-set B drag arms induction current while B changes', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-set', { key: 'B', value: -1 });
  handlers.onUiAction('faraday-set', { key: 'x', value: 4.5 });
  assert.equal(
    handlers.onUiAction('faraday-set', { key: 'B', value: 1.5, live: true }),
    true,
  );
  assert.equal(state.data.sliderDragging, true);
  handlers.update(0, 0.05);
  assert.notEqual(state.data.currentSense, 'none');
  assert.ok(Math.abs(state.data.liveEmf) > 1e-6);
  handlers.endManipulation?.(null, { time: state.data._time });
  assert.equal(state.data.sliderDragging, false);
  assert.ok(state.data.lastInduction);
});

test('non-live faraday-set B/x does not leave a stuck gesture', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-set', { key: 'B', value: 0.8 });
  handlers.onUiAction('faraday-set', { key: 'x', value: 3.2 });
  assert.equal(state.data.dragging, false);
  assert.equal(state.data.sliderDragging, false);
  close(state.data.B, 0.8);
  close(state.data.x, 3.2);
  // Preset-then-play still works after discrete setup sets.
  handlers.onUiAction('faraday-set', { key: 'targetB', value: -0.8 });
  handlers.onUiAction('faraday-play', {});
  assert.ok(state.data.pendingAnim);
});

test('manual parameter modification reverts played state to 自动演示', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-set', { key: 'B', value: -1 });
  handlers.onUiAction('faraday-set', { key: 'targetB', value: 2 });
  handlers.onUiAction('faraday-set', { key: 'animDuration', value: 1 });
  handlers.onUiAction('faraday-play', {});

  for (let i = 0; i < 30; i += 1) handlers.update(0, 0.05);
  assert.ok(state.data.lastInduction);

  let cfg = getDeskSliderConfig('electro', 'faraday_induction', state.data);
  let actionGrp = cfg.specs.find((s) => s.kind === 'actionGroup' && s.buttons?.some((it) => it.action === 'faraday-play'));
  let playBtn = actionGrp.buttons.find((it) => it.action === 'faraday-play');
  assert.equal(playBtn.label, '重复变化');

  // Manual parameter modification changes targetB -> reverts label to 自动演示
  handlers.onUiAction('faraday-set', { key: 'targetB', value: 2.5 });
  cfg = getDeskSliderConfig('electro', 'faraday_induction', state.data);
  actionGrp = cfg.specs.find((s) => s.kind === 'actionGroup' && s.buttons?.some((it) => it.action === 'faraday-play'));
  playBtn = actionGrp.buttons.find((it) => it.action === 'faraday-play');
  assert.equal(playBtn.label, '自动演示');
});

test('Faraday conductor rod 3D raycaster drag follows 3D ray directly with 1:1 tracking', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-set', { key: 'B', value: -1 });
  const rod = { userData: { role: 'faraday_rod' } };

  // Ray pointing at x=4.5 (local X = -0.48 + 4.5 * 0.12 = 0.06)
  const initialRay = {
    ray: {
      origin: new THREE.Vector3(0.06, 5, 0),
      direction: new THREE.Vector3(0, -1, 0),
    },
  };
  assert.equal(handlers.beginManipulation(rod, { raycaster: initialRay }), true);
  assert.equal(state.data.dragging, true);

  // Drag ray to target x=6.0 (local X = -0.48 + 6.0 * 0.12 = 0.24)
  const moveRay = {
    ray: {
      origin: new THREE.Vector3(0.24, 5, 0),
      direction: new THREE.Vector3(0, -1, 0),
    },
  };
  assert.equal(handlers.updateManipulation(rod, { raycaster: moveRay, dt: 1 / 60 }), true);
  close(state.data.x, 6.0, 1e-4);
  assert.notEqual(state.data.currentSense, 'none');
  assert.ok(Math.abs(state.data.liveEmf) > 1e-6);

  // Drag beyond xMax (local X = 2.0 -> clamped to 8.0)
  const outRay = {
    ray: {
      origin: new THREE.Vector3(2.0, 5, 0),
      direction: new THREE.Vector3(0, -1, 0),
    },
  };
  assert.equal(handlers.updateManipulation(rod, { raycaster: outRay, dt: 1 / 60 }), true);
  close(state.data.x, 8.0, 1e-4);

  handlers.endManipulation(rod);
  assert.equal(state.data.dragging, false);
  assert.ok(state.data.lastMotion);
});

test('Faraday 3D magnetic field arrows update dynamically with sign and strength', () => {
  const origDoc = globalThis.document;
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        return {
          width: 512,
          height: 256,
          getContext: () => ({
            clearRect: () => {},
            fillRect: () => {},
            strokeRect: () => {},
            fillText: () => {},
            strokeText: () => {},
            measureText: () => ({ width: 10 }),
            createLinearGradient: () => ({ addColorStop: () => {} }),
            createRadialGradient: () => ({ addColorStop: () => {} }),
            beginPath: () => {},
            closePath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            arc: () => {},
            arcTo: () => {},
            ellipse: () => {},
            fill: () => {},
            stroke: () => {},
            save: () => {},
            restore: () => {},
            setLineDash: () => {},
          }),
        };
      }
      return {};
    },
  };

  try {
    const station = createElectroEquipment({
      THREE,
      renderer: { compileAsync: async () => {} },
      camera: new THREE.PerspectiveCamera(),
      scene: new THREE.Scene(),
    });

    const runtime = station.equipment.createRuntime('faraday_induction');
    station.equipment.setMode('faraday');

    // Initial update with B = -1 (downwards orange arrows)
    station.equipment.updateFaraday({ B: -1, x: 4.5, showField: true }, 0);
    const faradayGroup = station.root.getObjectByName('faraday-induction-apparatus');
    assert.ok(faradayGroup, 'Faraday apparatus group must exist in electro station');

    const fieldArrowGroup = faradayGroup.getObjectByName('faraday-field-arrows');
    if (fieldArrowGroup) {
      const shaft = fieldArrowGroup.getObjectByName('faraday-field-arrows-shaft');
      assert.ok(shaft && (shaft.count ?? shaft.instanceMatrix?.count ?? 0) >= 10, 'Must have active visible B arrows for B = -1');
    } else {
      const visibleArrowsDown = faradayGroup.children[0].children.filter((c) => c.visible);
      assert.ok(visibleArrowsDown.length >= 10, 'Must have active visible B arrows for B = -1');
      assert.equal(visibleArrowsDown[0].line.material.color.getHexString(), 'f97316', 'B < 0 arrows must be orange/amber');
    }

    // Change to B = +1.5 (upwards cyan arrows)
    station.equipment.updateFaraday({ B: 1.5, x: 4.5, showField: true }, 0);
    if (fieldArrowGroup) {
      const shaft = fieldArrowGroup.getObjectByName('faraday-field-arrows-shaft');
      assert.ok(shaft && (shaft.count ?? shaft.instanceMatrix?.count ?? 0) >= 10, 'Must have active visible B arrows for B = 1.5');
    } else {
      const visibleArrowsUp = faradayGroup.children[0].children.filter((c) => c.visible);
      assert.ok(visibleArrowsUp.length >= 10, 'Must have active visible B arrows for B = 1.5');
      assert.equal(visibleArrowsUp[0].line.material.color.getHexString(), '38bdf8', 'B > 0 arrows must be sky-blue/cyan');
    }
  } finally {
    if (origDoc === undefined) delete globalThis.document;
    else globalThis.document = origDoc;
  }
});

