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
import {
  drawHoloScreen,
  faradayBFromSliderPick,
  getHoloScreenLayoutSize,
  pickHoloScreen,
} from '../src/holoScreen.js';
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
  close(faradayArea(0.45), (0.45 - 0.025) * FARADAY_ROD_LENGTH);
  close(faradayFlux(-1, 0.45), -0.17);
  assert.equal(faradayFlux(0, 0.45), 0);
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
  handlers.onUiAction('faraday-set', { key: 'x', value: 0.3 });
  handlers.onUiAction('faraday-set', { key: 'targetX', value: 0.7 });
  handlers.onUiAction('faraday-set', { key: 'animDuration', value: 0.8 });
  handlers.onUiAction('faraday-channel', { channel: 'x' });
  handlers.onUiAction('faraday-play', {});
  assert.ok(state.data.pendingAnim);
  assert.equal(state.data.pendingAnim.channel, 'x');

  for (let i = 0; i < 30; i += 1) handlers.update(0, 0.05);
  assert.equal(state.data.pendingAnim, null);
  close(state.data.x, 0.7, 1e-5);
  assert.ok(state.data.lastMotion);
  close(state.data.lastMotion.x0, 0.3, 1e-5);
  close(state.data.lastMotion.x1, 0.7, 1e-5);
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

test('Faraday reverse x in motional mode keeps channel x and reverses motion', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-channel', { channel: 'x' });
  assert.equal(state.data.animChannel, 'x');

  // Initial x = 0.45, targetX = 0.65. Reverse should target 0.45 - (0.65 - 0.45) = 0.25
  handlers.onUiAction('faraday-reverse', {});
  assert.ok(state.data.pendingAnim);
  assert.equal(state.data.pendingAnim.channel, 'x');
  assert.equal(state.data.animChannel, 'x', 'channel must remain x and NOT switch to B');
  close(state.data.pendingAnim.to, 0.25, 1e-5);

  // Verify desk slider config keeps motional channel
  const cfg = getDeskSliderConfig('electro', 'faraday_induction', state.data);
  const motionBtn = cfg.specs[0].buttons.find((b) => b.label === '动生');
  assert.equal(motionBtn.active, true, '动生 toggle button must remain active');

  // Finish the animation
  for (let i = 0; i < 40; i += 1) handlers.update(0, 0.05);
  assert.equal(state.data.pendingAnim, null);
  close(state.data.x, 0.25, 1e-5);
  assert.ok(state.data.lastMotion);
  assert.equal(state.data.animChannel, 'x');

  // Reverse again from 0.25 back towards 0.45
  handlers.onUiAction('faraday-reverse', {});
  assert.ok(state.data.pendingAnim);
  assert.equal(state.data.pendingAnim.channel, 'x');
  assert.equal(state.data.animChannel, 'x');
  close(state.data.pendingAnim.to, 0.45, 1e-5);

  for (let i = 0; i < 40; i += 1) handlers.update(0, 0.05);
  assert.equal(state.data.pendingAnim, null);
  close(state.data.x, 0.45, 1e-5);
  assert.equal(state.data.animChannel, 'x');
});

test('Faraday reverse x after auto play smoothly reverses back to start position', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-channel', { channel: 'x' });
  handlers.onUiAction('faraday-set', { key: 'x', value: 0.3 });
  handlers.onUiAction('faraday-set', { key: 'targetX', value: 0.6 });
  handlers.onUiAction('faraday-play', {});

  for (let i = 0; i < 40; i += 1) handlers.update(0, 0.05);
  close(state.data.x, 0.6, 1e-5);

  // In motional mode, clicking reverse should animate from 0.6 back to 0.3
  handlers.onUiAction('faraday-reverse', {});
  assert.ok(state.data.pendingAnim);
  assert.equal(state.data.pendingAnim.channel, 'x');
  assert.equal(state.data.animChannel, 'x');
  close(state.data.pendingAnim.to, 0.3, 1e-5);

  for (let i = 0; i < 40; i += 1) handlers.update(0, 0.05);
  close(state.data.x, 0.3, 1e-5);
  assert.equal(state.data.animChannel, 'x');
});

test('live faraday-set x drag arms motional current while x changes', () => {
  const { state, handlers } = faradayContext();
  handlers.onUiAction('faraday-set', { key: 'B', value: -1 });
  handlers.onUiAction('faraday-set', { key: 'x', value: 0.3 });
  // Live desk/content drag: begin motion measurement + update x.
  assert.equal(
    handlers.onUiAction('faraday-set', { key: 'x', value: 0.5, live: true }),
    true,
  );
  assert.equal(state.data.dragging, true);
  assert.ok(state.data.motionStart);
  close(state.data.x, 0.5);
  // One frame of velocity → non-zero emf / Lenz sense.
  handlers.update(0, 0.05);
  assert.notEqual(state.data.currentSense, 'none');
  assert.ok(Math.abs(state.data.liveEmf) > 1e-6);
  // Release finishes the motion record (same path as rod drag).
  handlers.endManipulation?.(null, { time: state.data._time });
  assert.equal(state.data.dragging, false);
  assert.ok(state.data.lastMotion);
  close(state.data.lastMotion.x0, 0.3, 1e-5);
  close(state.data.lastMotion.x1, 0.5, 1e-5);
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
  handlers.onUiAction('faraday-set', { key: 'x', value: 0.45 });
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
  handlers.onUiAction('faraday-set', { key: 'x', value: 0.32 });
  assert.equal(state.data.dragging, false);
  assert.equal(state.data.sliderDragging, false);
  close(state.data.B, 0.8);
  close(state.data.x, 0.32);
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

  // Ray pointing at x=0.45 (local X = -0.48 + 0.45 * 1.2 = 0.06)
  const initialRay = {
    ray: {
      origin: new THREE.Vector3(0.06, 5, 0),
      direction: new THREE.Vector3(0, -1, 0),
    },
  };
  assert.equal(handlers.beginManipulation(rod, { raycaster: initialRay }), true);
  assert.equal(state.data.dragging, true);

  // Drag ray to target x=0.60 (local X = -0.48 + 0.60 * 1.2 = 0.24)
  const moveRay = {
    ray: {
      origin: new THREE.Vector3(0.24, 5, 0),
      direction: new THREE.Vector3(0, -1, 0),
    },
  };
  assert.equal(handlers.updateManipulation(rod, { raycaster: moveRay, dt: 1 / 60 }), true);
  close(state.data.x, 0.60, 1e-4);
  assert.notEqual(state.data.currentSense, 'none');
  assert.ok(Math.abs(state.data.liveEmf) > 1e-6);

  // Drag beyond xMax (local X = 2.0 -> clamped to 0.80)
  const outRay = {
    ray: {
      origin: new THREE.Vector3(2.0, 5, 0),
      direction: new THREE.Vector3(0, -1, 0),
    },
  };
  assert.equal(handlers.updateManipulation(rod, { raycaster: outRay, dt: 1 / 60 }), true);
  close(state.data.x, 0.80, 1e-4);

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
    station.equipment.updateFaraday({ B: -1, x: 0.45, showField: true }, 0);
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
    station.equipment.updateFaraday({ B: 1.5, x: 0.45, showField: true }, 0);
    if (fieldArrowGroup) {
      const shaft = fieldArrowGroup.getObjectByName('faraday-field-arrows-shaft');
      assert.ok(shaft && (shaft.count ?? shaft.instanceMatrix?.count ?? 0) >= 10, 'Must have active visible B arrows for B = 1.5');
    } else {
      const visibleArrowsUp = faradayGroup.children[0].children.filter((c) => c.visible);
      assert.ok(visibleArrowsUp.length >= 10, 'Must have active visible B arrows for B = 1.5');
      assert.equal(visibleArrowsUp[0].line.material.color.getHexString(), '38bdf8', 'B > 0 arrows must be sky-blue/cyan');
    }

    // Smooth animation across B = 0 (|B| < 0.02) must re-sync arrow orientation and keep arrows above the desk
    if (fieldArrowGroup) {
      const head = fieldArrowGroup.getObjectByName('faraday-field-arrows-head');
      const mat = new THREE.Matrix4();
      const arrowLength = 1.02 * 0.12;
      const collectActiveArrows = () => {
        const active = [];
        for (let i = 0; i < head.count; i += 1) {
          head.getMatrixAt(i, mat);
          const e = mat.elements;
          const sx = Math.hypot(e[0], e[1], e[2]);
          if (sx < 1e-4) continue;
          active.push({ originY: e[13], dirY: e[5] });
        }
        return active;
      };

      for (const B of [-1, -0.5, -0.01, 0.01, 0.03, 0.5, 1.5]) {
        station.equipment.updateFaraday({ B, x: 0.662, showField: true }, 1 / 60);
      }
      const upArrows = collectActiveArrows();
      assert.ok(upArrows.length >= 10, 'B = +1.5 after crossing 0 must render visible arrows');
      for (const arrow of upArrows) {
        assert.ok(arrow.dirY > 0.99, `B > 0 arrow must point +Y, got dirY=${arrow.dirY}`);
        assert.ok(arrow.originY > 0, `B > 0 arrow origin must stay above desk, got ${arrow.originY}`);
        assert.ok(arrow.originY + arrow.dirY * arrowLength > arrow.originY);
      }

      for (const B of [0.5, 0.01, -0.01, -0.03, -0.5, -1]) {
        station.equipment.updateFaraday({ B, x: 0.662, showField: true }, 1 / 60);
      }
      const downArrows = collectActiveArrows();
      assert.ok(downArrows.length >= 10, 'B = -1 after crossing 0 must render visible arrows');
      for (const arrow of downArrows) {
        assert.ok(arrow.dirY < -0.99, `B < 0 arrow must point -Y, got dirY=${arrow.dirY}`);
        const tipY = arrow.originY + arrow.dirY * arrowLength;
        assert.ok(tipY > 0, `B < 0 arrow tip must stay above desk, got tipY=${tipY}`);
      }

      // Crossing below 0.02 from 0.03 must hide arrows immediately
      station.equipment.updateFaraday({ B: 0.03, x: 0.662, showField: true }, 1 / 60);
      assert.ok(head.count > 0);
      station.equipment.updateFaraday({ B: 0.01, x: 0.662, showField: true }, 1 / 60);
      assert.equal(head.count, 0, 'Dropping from 0.03 into |B| < 0.02 must hide arrows immediately');
    }
  } finally {
    if (origDoc === undefined) delete globalThis.document;
    else globalThis.document = origDoc;
  }
});

test('Faraday floating display integrates all desk controls and resolves exact slider/button hits', () => {
  const { state } = faradayContext();
  const experiment = STATION_EXPERIMENTS.electro.experiments.find((item) => item.id === 'faraday_induction');
  const station = { id: 'electro', name: '电磁学实验台', experiments: STATION_EXPERIMENTS.electro.experiments };
  const stubCtx = {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    fill() {},
    stroke() {},
    addColorStop() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    measureText() { return { width: 48 }; },
  };

  for (const [surface, W, H] of [['display', 1152, 768], ['full', 1024, 660]]) {
    const hud = { running: true, station, experiment, data: { ...state.data } };
    const res = drawHoloScreen(stubCtx, W, H, {
      active: true,
      hud,
      surface,
      theme: surface === 'display' ? 'light' : 'dark',
      fullTitle: '电磁学实验台',
      enTitle: 'ELECTROMAGNETISM',
    });

    const hits = res.hits;
    const channelXHit = hits.find((h) => h.action === 'faraday-channel' && h.channel === 'x');
    const channelBHit = hits.find((h) => h.action === 'faraday-channel' && h.channel === 'B');
    const targetBHit = hits.find((h) => h.action === 'param-slider' && h.key === 'targetB');
    const durationHit = hits.find((h) => h.action === 'param-slider' && h.key === 'animDuration');
    const liveBHit = hits.find((h) => h.action === 'param-slider' && h.key === 'B');
    const liveXHit = hits.find((h) => h.action === 'param-slider' && h.key === 'x');
    const playHit = hits.find((h) => h.action === 'faraday-play');
    const reverseHit = hits.find((h) => h.action === 'faraday-reverse');
    const toggleFieldHit = hits.find((h) => h.action === 'faraday-toggle-field');
    const resetHit = hits.find((h) => h.action === 'faraday-reset');

    for (const [name, hit] of [
      ['channelX', channelXHit],
      ['channelB', channelBHit],
      ['targetB', targetBHit],
      ['animDuration', durationHit],
      ['liveB', liveBHit],
      ['liveX', liveXHit],
      ['play', playHit],
      ['reverse', reverseHit],
      ['toggleField', toggleFieldHit],
      ['reset', resetHit],
    ]) {
      assert.ok(hit, `${surface}: expected ${name} hit region`);
      assert.ok(hit.y >= 0 && hit.y + hit.h <= H, `${surface}: ${name} hit must fit vertically inside ${H}`);
      assert.ok(hit.x >= 0 && hit.x + hit.w <= W, `${surface}: ${name} hit must fit horizontally inside ${W}`);
      const u = (hit.x + hit.w / 2) / W;
      const v = 1 - (hit.y + hit.h / 2) / H;
      const picked = pickHoloScreen(u, v, W, H, hits, 1);
      assert.ok(picked, `${surface}: pickHoloScreen must resolve ${name}`);
      assert.equal(picked.id || picked.action, hit.id || hit.action, `${surface}: center of ${name} must not be stolen by adjacent hit`);
    }

    // Switching animChannel to 'x' swaps targetB slider for targetX
    const hudX = { running: true, station, experiment, data: { ...state.data, animChannel: 'x' } };
    const resX = drawHoloScreen(stubCtx, W, H, {
      active: true,
      hud: hudX,
      surface,
      theme: surface === 'display' ? 'light' : 'dark',
    });
    assert.ok(resX.hits.some((h) => h.action === 'param-slider' && h.key === 'targetX'));
    assert.ok(!resX.hits.some((h) => h.action === 'param-slider' && h.key === 'targetB'));
  }

  const layoutDisplay = getHoloScreenLayoutSize({
    active: true,
    surface: 'display',
    hud: { running: true, experiment },
  });
  assert.ok(layoutDisplay.width >= 1152 && layoutDisplay.height >= 780);
});

test('Faraday 3D induced-current arrows point CW/CCW from +y view for motional and inductive EMF', () => {
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
    station.equipment.setMode('faraday');
    const faradayGroup = station.root.getObjectByName('faraday-induction-apparatus');
    const flowHead = faradayGroup.getObjectByName('induced-current-arrows-head');
    assert.ok(flowHead, 'induced-current-arrows-head must exist');

    const x = 0.45;
    const loopCenterX = -0.48 + ((0.025 + x) * 0.5) * 1.2;
    const mat = new THREE.Matrix4();
    const col = new THREE.Color();
    const checkDirection = (sense, expectedSign, expectedHex) => {
      station.equipment.updateFaraday({ B: -1, x, showField: true, currentSense: sense }, 1 / 60);
      assert.ok(flowHead.count >= 8, `Expected visible flow arrows for ${sense}`);
      for (let i = 0; i < flowHead.count; i += 1) {
        flowHead.getMatrixAt(i, mat);
        flowHead.getColorAt(i, col);
        assert.equal(col.getHexString(), expectedHex, `Sense ${sense}: arrow ${i} color must not fall back to white`);
        const e = mat.elements;
        const rx = e[12] - loopCenterX;
        const rz = e[14];
        const dirX = e[4];
        const dirZ = e[6];
        // Looking from +y: (r x dir).y = rz * dirX - rx * dirZ is < 0 for CW and > 0 for CCW.
        const crossY = rz * dirX - rx * dirZ;
        assert.ok(
          crossY * expectedSign > 0.01,
          `Sense ${sense}: arrow ${i} at (${rx.toFixed(3)}, ${rz.toFixed(3)}) dir (${dirX.toFixed(2)}, ${dirZ.toFixed(2)}) has wrong chirality crossY=${crossY.toFixed(4)}`,
        );
      }
    };

    checkDirection('cw', -1, 'f472b6');
    checkDirection('ccw', 1, 'a78bfa');
  } finally {
    if (origDoc === undefined) delete globalThis.document;
    else globalThis.document = origDoc;
  }
});

