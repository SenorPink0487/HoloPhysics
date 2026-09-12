/**
 * Desk slider panel: row selection under angled rays.
 * Regression for “aiming 半径 R / dB/dt but resolving as 磁感应 B”.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Node has no DOM; desk header / action textures only need a stub canvas.
const canvasStub = {
  width: 0,
  height: 0,
  getContext: () => ({
    clearRect() {},
    fillText() {},
    beginPath() {},
    moveTo() {},
    arcTo() {},
    arc() {},
    closePath() {},
    fill() {},
    stroke() {},
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'middle',
  }),
};
globalThis.document = {
  createElement: (tag) => {
    if (tag === 'canvas') return { ...canvasStub, width: 0, height: 0 };
    return {};
  },
};

const { createDeskSliderPanel } = await import('../src/scene/shared/deskSliders.js');

const INDUCED_SPECS = [
  { key: 'R', label: '半径 R', min: 0.8, max: 3.0, value: 0.81, setAction: 'induced-e-set', action: 'induced-e-slider' },
  { key: 'dBdt', label: 'dB/dt', min: -6.25, max: 6.25, value: 5.68, setAction: 'induced-e-set', action: 'induced-e-slider' },
];

function makePanel() {
  const panel = createDeskSliderPanel({ stationId: 'electro', accentHex: '#ec4899', accentNum: 0xec4899 });
  panel.position.set(0, 0.9, 0);
  panel.updateMatrixWorld(true);
  panel.userData.setPresent(true);
  panel.userData.setSpecs(INDUCED_SPECS);
  panel.updateMatrixWorld(true);
  return panel;
}

/** Ray from elevated “seated” eye toward a local point on the card surface. */
function rayTowardLocal(panel, localX, localY, localZ) {
  const target = new THREE.Vector3(localX, localY, localZ);
  panel.localToWorld(target);
  // Camera above and in front of the sitting edge (+Z), looking down at the card.
  const origin = new THREE.Vector3(panel.position.x, panel.position.y + 0.55, panel.position.z + 0.75);
  const dir = target.clone().sub(origin).normalize();
  const rc = new THREE.Raycaster(origin, dir);
  return rc;
}

test('angled ray aimed at 半径 R resolves R', () => {
  const panel = makePanel();
  let topZ = null;
  for (let z = -0.25; z <= 0.25; z += 0.005) {
    const pick = panel.userData.pickFromRay(rayTowardLocal(panel, 0, 0.03, z));
    if (pick?.key === 'R') {
      topZ = z;
      break;
    }
  }
  assert.ok(topZ != null, 'expected to locate R row Z');
  const pick = panel.userData.pickFromRay(rayTowardLocal(panel, 0, 0.03, topZ));
  assert.equal(pick?.key, 'R');
});

test('downward ray that clips a front grab still selects the rear row under the crosshair', () => {
  const panel = makePanel();
  let topZ = null;
  for (let z = -0.25; z <= 0.25; z += 0.005) {
    const pick = panel.userData.pickFromRay(rayTowardLocal(panel, 0, 0.03, z));
    if (pick?.key === 'R') {
      topZ = z;
      break;
    }
  }
  const pick = panel.userData.pickFromRay(rayTowardLocal(panel, 0, 0.03, topZ));
  assert.equal(pick?.key, 'R', `steep aim at rear row must be R, got ${pick?.key}`);
});

test('each induced-E row is independently selectable under downward aim', () => {
  const panel = makePanel();
  // Probe active row Z centers from the panel’s own layout by scanning local Z.
  const found = new Map();
  for (let z = -0.22; z <= 0.22; z += 0.008) {
    const pick = panel.userData.pickFromRay(rayTowardLocal(panel, 0.05, 0.03, z));
    if (pick?.key) found.set(pick.key, (found.get(pick.key) || 0) + 1);
  }
  for (const key of ['R', 'dBdt']) {
    assert.ok(found.has(key), `expected to be able to aim ${key}, got keys: ${[...found.keys()].join(',')}`);
  }
});

test('pick value follows local X on the aimed track', () => {
  const panel = makePanel();
  // Hit near the right end of the dBdt track (bipolar −6.25…6.25).
  let dZ = null;
  for (let z = -0.22; z <= 0.22; z += 0.006) {
    const probe = panel.userData.pickFromRay(rayTowardLocal(panel, 0, 0.03, z));
    if (probe?.key === 'dBdt') {
      dZ = z;
      break;
    }
  }
  assert.ok(dZ != null, 'could not locate dBdt row Z');
  const left = panel.userData.pickFromRay(rayTowardLocal(panel, -0.22, 0.03, dZ));
  const right = panel.userData.pickFromRay(rayTowardLocal(panel, 0.22, 0.03, dZ));
  assert.equal(left?.key, 'dBdt');
  assert.equal(right?.key, 'dBdt');
  assert.ok(left.value < 0, `left of bipolar dBdt should be negative, got ${left.value}`);
  assert.ok(right.value > 0, `right of bipolar dBdt should be positive, got ${right.value}`);
});

test('Hall desk panel exposes discrete 记录当前读数 action chip', () => {
  const panel = createDeskSliderPanel({ stationId: 'electro', accentHex: '#ec4899', accentNum: 0xec4899 });
  panel.position.set(0, 0.9, 0);
  panel.updateMatrixWorld(true);
  panel.userData.setPresent(true);
  panel.userData.setSpecs([
    { kind: 'range', key: 'Im', label: '励磁电流 Im', min: 0, max: 1, value: 0.5, setAction: 'hall-set', action: 'param-slider' },
    { kind: 'range', key: 'Is', label: '霍尔电流 Is', min: 0, max: 10, value: 5, setAction: 'hall-set', action: 'param-slider' },
    { kind: 'range', key: 'probePos', label: '探头 X', min: -25, max: 25, value: 0, setAction: 'hall-set', action: 'param-slider' },
    { kind: 'range', key: 'rightCoilPos', label: '右线圈位置', min: -0.5, max: 13, value: 2.5, setAction: 'hall-set', action: 'param-slider' },
    { kind: 'action', key: 'hall-record', label: '记录当前读数', action: 'hall-record' },
  ]);
  panel.updateMatrixWorld(true);

  let found = null;
  for (let z = -0.28; z <= 0.28; z += 0.006) {
    const pick = panel.userData.pickFromRay(rayTowardLocal(panel, 0, 0.03, z));
    if (pick?.action === 'hall-record') {
      found = pick;
      break;
    }
  }
  assert.ok(found, 'expected to aim the record action chip');
  assert.equal(found.kind, 'action');
  assert.equal(found.role, 'desk_action');
  assert.equal(found.action, 'hall-record');
});

test('desk panel actionGroup resolves discrete buttons based on local X aim', async () => {
  const { getDeskSliderConfig } = await import('../src/deskSliderCatalog.js');
  const config = getDeskSliderConfig('electro', 'faraday_induction', { animChannel: 'B' });
  assert.ok(config.specs.length >= 6);

  const panel = createDeskSliderPanel({ stationId: 'electro', accentHex: '#ec4899', accentNum: 0xec4899 });
  panel.position.set(0, 0.9, 0);
  panel.updateMatrixWorld(true);
  panel.userData.setPresent(true);
  panel.userData.setSpecs(config.specs);
  panel.updateMatrixWorld(true);

  // Scan top row Z for actionGroup hits (动生 / 感生)
  let topZ = null;
  for (let z = -0.35; z <= 0.35; z += 0.005) {
    const pick = panel.userData.pickFromRay(rayTowardLocal(panel, -0.18, 0.03, z));
    if (pick?.action === 'faraday-channel') {
      topZ = z;
      break;
    }
  }
  assert.ok(topZ != null, 'expected to find top row actionGroup Z');

  // Scan bottom row Z for actionGroup hits (自动演示 / 反向变化)
  let botZ = null;
  for (let z = -0.35; z <= 0.35; z += 0.005) {
    const pick = panel.userData.pickFromRay(rayTowardLocal(panel, -0.18, 0.03, z));
    if (pick?.action === 'faraday-play') {
      botZ = z;
      break;
    }
  }
  assert.ok(botZ != null, 'expected to find bottom row actionGroup Z');

  const leftPick = panel.userData.pickFromRay(rayTowardLocal(panel, -0.18, 0.03, topZ));
  const midPick = panel.userData.pickFromRay(rayTowardLocal(panel, 0, 0.03, topZ));
  const botLeftPick = panel.userData.pickFromRay(rayTowardLocal(panel, -0.18, 0.03, botZ));
  const botRightPick = panel.userData.pickFromRay(rayTowardLocal(panel, 0.18, 0.03, botZ));

  assert.equal(leftPick?.action, 'faraday-channel');
  assert.equal(leftPick?.payload?.channel, 'x');
  assert.equal(midPick?.action, 'faraday-channel');
  assert.equal(midPick?.payload?.channel, 'B');
  assert.equal(botLeftPick?.action, 'faraday-play');
  assert.equal(botRightPick?.action, 'faraday-reverse');
});

test('Hall slider with step=0.01 quantizes drag values to 0.01 multiples', async () => {
  const { getDeskSliderConfig } = await import('../src/deskSliderCatalog.js');
  const config = getDeskSliderConfig('electro', 'hall_effect', { target: 'helmholtz' });
  const probeSpec = config.specs.find((s) => s.key === 'probePos');
  assert.ok(probeSpec, 'expected probeSpec spec in hall config');
  assert.equal(probeSpec.step, 0.01);
  assert.equal(probeSpec.buttonDelta, 0.005);

  const panel = createDeskSliderPanel({ stationId: 'electro', accentHex: '#ec4899', accentNum: 0xec4899 });
  panel.position.set(0, 0.9, 0);
  panel.updateMatrixWorld(true);
  panel.userData.setPresent(true);
  panel.userData.setSpecs(config.specs);
  panel.updateMatrixWorld(true);

  // Locate row Z for probePos without lockedKey
  let probeZ = null;
  for (let z = -0.35; z <= 0.35; z += 0.005) {
    const p = panel.userData.pickFromRay(rayTowardLocal(panel, 0, 0.03, z));
    if (p?.key === 'probePos') {
      probeZ = z;
      break;
    }
  }
  assert.ok(probeZ != null, 'expected to find probePos row Z');

  // Sample multiple points across the track and verify value is an exact multiple of 0.01
  for (let x = -0.15; x <= 0.15; x += 0.012) {
    const pick = panel.userData.pickFromRay(rayTowardLocal(panel, x, 0.03, probeZ), 'probePos');
    assert.equal(pick?.key, 'probePos');
    const remainder = Math.abs((pick.value - probeSpec.min) % 0.01);
    const isStepMultiple = remainder < 1e-5 || Math.abs(remainder - 0.01) < 1e-5;
    assert.ok(isStepMultiple, `expected ${pick.value} to be multiple of 0.01 from min ${probeSpec.min}`);
  }
});

test('Hall slider row resolves discrete minus and plus buttons when aimed at left and right sides', async () => {
  const { getDeskSliderConfig } = await import('../src/deskSliderCatalog.js');
  const config = getDeskSliderConfig('electro', 'hall_effect', { target: 'helmholtz' });

  const panel = createDeskSliderPanel({ stationId: 'electro', accentHex: '#ec4899', accentNum: 0xec4899 });
  panel.position.set(0, 0.9, 0);
  panel.updateMatrixWorld(true);
  panel.userData.setPresent(true);
  panel.userData.setSpecs(config.specs);
  panel.updateMatrixWorld(true);

  let probeZ = null;
  for (let z = -0.35; z <= 0.35; z += 0.005) {
    const p = panel.userData.pickFromRay(rayTowardLocal(panel, 0, 0.03, z));
    if (p?.key === 'probePos') {
      probeZ = z;
      break;
    }
  }
  assert.ok(probeZ != null, 'expected probePos row Z');

  // Aim at left button (localX around -0.23)
  const minusPick = panel.userData.pickFromRay(rayTowardLocal(panel, -0.23, 0.03, probeZ));
  assert.ok(minusPick, 'expected minus button pick');
  assert.equal(minusPick.role, 'desk_action');
  assert.equal(minusPick.kind, 'action');
  assert.equal(minusPick.action, 'hall-set');
  assert.equal(minusPick.payload?.key, 'probePos');
  assert.equal(minusPick.payload?.delta, -0.005);

  // Aim at right button (localX around +0.23)
  const plusPick = panel.userData.pickFromRay(rayTowardLocal(panel, 0.23, 0.03, probeZ));
  assert.ok(plusPick, 'expected plus button pick');
  assert.equal(plusPick.role, 'desk_action');
  assert.equal(plusPick.kind, 'action');
  assert.equal(plusPick.action, 'hall-set');
  assert.equal(plusPick.payload?.key, 'probePos');
  assert.equal(plusPick.payload?.delta, 0.005);

  // Active drag lock: aiming at -0.23 while dragging probePos must NOT fire the button
  const dragPick = panel.userData.pickFromRay(rayTowardLocal(panel, -0.23, 0.03, probeZ), 'probePos');
  assert.ok(dragPick);
  assert.equal(dragPick.role, 'param-slider');
  assert.equal(dragPick.key, 'probePos');
  assert.equal(dragPick.value, -0.25); // Clamped to min
});

test('Electro hall-set adjusts probePos by 0.005 delta and quantizes set values to 0.01', async () => {
  const { createHandlers: createElectroHandlers } = await import('../src/experiments/electro.js');
  const ctx = {
    state: { expId: 'hall_effect', stepIndex: 2, data: {} },
    equipment: { electro: { updateHall: () => {}, setHallWiring: () => {} } },
    toast: () => {},
    pushHud: () => {},
    advanceStep: () => {},
    setStep: () => {},
    currentStep: () => ({ id: 'scan' }),
    currentExp: () => null,
    currentStation: () => null,
  };
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');
  ctx.state.data.target = 'helmholtz';

  // Test delta increments (+0.005 and -0.005)
  handlers.onUiAction('hall-set', { key: 'probePos', value: 0.00 });
  assert.equal(ctx.state.data.probePos, 0.00);

  handlers.onUiAction('hall-set', { key: 'probePos', delta: 0.005 });
  assert.equal(ctx.state.data.probePos, 0.005);

  handlers.onUiAction('hall-set', { key: 'probePos', delta: 0.005 });
  assert.equal(ctx.state.data.probePos, 0.01);

  handlers.onUiAction('hall-set', { key: 'probePos', delta: -0.005 });
  assert.equal(ctx.state.data.probePos, 0.005);

  // Test snapping to 0.01 on value set
  handlers.onUiAction('hall-set', { key: 'probePos', value: 0.018 });
  assert.equal(ctx.state.data.probePos, 0.020);

  handlers.onUiAction('hall-set', { key: 'probePos', value: -0.014 });
  assert.equal(ctx.state.data.probePos, -0.01);
});

test('Desk slider panel plus and minus buttons have circular cylinder geometry', async () => {
  const { getDeskSliderConfig } = await import('../src/deskSliderCatalog.js');
  const config = getDeskSliderConfig('electro', 'hall_effect', { target: 'helmholtz' });
  const panel = createDeskSliderPanel({ stationId: 'electro', accentHex: '#ec4899', accentNum: 0xec4899 });
  panel.userData.setSpecs(config.specs);

  // Inspect slot children
  const slot = panel.userData.getSlots?.()[0];
  assert.ok(slot, 'expected at least one slot');
  assert.ok(slot.btnMinus, 'expected btnMinus group');
  assert.ok(slot.btnPlus, 'expected btnPlus group');

  // Verify body geometry is CylinderGeometry
  const minusBody = slot.btnMinus.children.find((c) => c.geometry instanceof THREE.CylinderGeometry);
  const plusBody = slot.btnPlus.children.find((c) => c.geometry instanceof THREE.CylinderGeometry);
  assert.ok(minusBody, 'expected minus button body to be CylinderGeometry');
  assert.ok(plusBody, 'expected plus button body to be CylinderGeometry');
});
 
test('Electro hall-record triggers toast notification with sequence, position, VH, and milestone', async () => {
  const { createHandlers: createElectroHandlers } = await import('../src/experiments/electro.js');
  const toasts = [];
  const deskPanel = createDeskSliderPanel({ stationId: 'electro', accentHex: '#ec4899', accentNum: 0xec4899 });
  deskPanel.userData.setSpecs([
    { kind: 'action', key: 'hall-record', label: '记录当前读数', action: 'hall-record' },
  ]);

  const ctx = {
    state: { expId: 'hall_effect', stepIndex: 2, data: {} },
    equipment: {
      electro: { updateHall: () => {}, setHallWiring: () => {} },
      deskSliders: { electro: deskPanel },
    },
    toast: (msg) => toasts.push(msg),
    pushHud: () => {},
    advanceStep: () => {},
    setStep: () => {},
    currentStep: () => ({ id: 'scan' }),
    currentExp: () => null,
    currentStation: () => null,
  };
  const handlers = createElectroHandlers(ctx);
  ctx.state.data = handlers.initData('hall_effect');
  ctx.state.data.target = 'helmholtz';
  ctx.state.data.probePos = 0.015;
  ctx.state.data.Im = 0.5;
  ctx.state.data.Is = 0.005;

  // First record
  handlers.onUiAction('hall-record');
  assert.equal(ctx.state.data.records.length, 1);
  assert.ok(Number.isFinite(ctx.state.data.lastRecordedTime));
  assert.equal(ctx.state.data.lastRecordedIndex, 0);
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].includes('已记录第 1 组'));
  assert.ok(toasts[0].includes('X=0.015 m'));
  assert.ok(toasts[0].includes('VH='));

  // Second record
  handlers.onUiAction('hall-record');
  assert.equal(ctx.state.data.records.length, 2);
  assert.equal(toasts.length, 2);
  assert.ok(toasts[1].includes('已记录第 2 组'));

  // Third record triggers milestone prompt in toast
  handlers.onUiAction('hall-record');
  assert.equal(ctx.state.data.records.length, 3);
  assert.equal(toasts.length, 3);
  assert.ok(toasts[2].includes('已记录第 3 组'));
  assert.ok(toasts[2].includes('可拟合'));
});

