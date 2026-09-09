import test from 'node:test';
import assert from 'node:assert/strict';

import { hallDemoForce, hallDemoVoltage } from '../src/experiments/electro.js';
import {
  createHallDemoEquipment,
  hallCarrierKinematics,
} from '../src/experiments/hallDemoEquipment.js';
import { drawHoloScreen, getHoloScreenLayoutSize, pickHoloScreen } from '../src/holoScreen.js';

const base = Object.freeze({ I: 1, B: 1, n: 1, d: 0.5, nType: true });

// Node has no DOM; carrier textures only need a stub canvas.
const canvasStub = {
  width: 0,
  height: 0,
  getContext: () => ({
    clearRect() {},
    fillRect() {},
    fillText() {},
    beginPath() {},
    roundRect() {},
    moveTo() {},
    arcTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 40 }),
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
    if (tag === 'canvas') return { ...canvasStub, width: 128, height: 128 };
    return {};
  },
};

test('Hall carrier demo preserves source polarity and reversal behavior', () => {
  assert.equal(hallDemoVoltage(base), -1);
  assert.equal(hallDemoVoltage({ ...base, B: -1 }), 1);
  assert.equal(hallDemoVoltage({ ...base, nType: false }), 1);
});

test('Hall carrier demo obeys proportionality and limiting cases', () => {
  assert.equal(hallDemoVoltage({ ...base, I: 0 }), 0);
  assert.equal(hallDemoVoltage({ ...base, B: 0 }), 0);
  assert.equal(hallDemoVoltage({ ...base, I: 2 }), -2);
  assert.equal(hallDemoVoltage({ ...base, n: 2 }), -0.5);
  assert.equal(hallDemoVoltage({ ...base, d: 1 }), -0.5);
  assert.equal(hallDemoForce({ ...base, I: 2, B: -1.5 }), 3);

  const kin1 = hallCarrierKinematics({ I: 1, B: 1, n: 1 });
  const kin2 = hallCarrierKinematics({ I: 1, B: 1, n: 2 });
  assert.equal(Math.abs(kin2.v0), Math.abs(kin1.v0) / 2, 'drift velocity v0 is inversely proportional to n');
});

test('n-type and p-type pile on the same geometric face for fixed I,B', () => {
  const nKin = hallCarrierKinematics({ I: 1, B: 1, nType: true });
  const pKin = hallCarrierKinematics({ I: 1, B: 1, nType: false });
  assert.equal(nKin.flowDirection, -1, 'electrons drift opposite +I');
  assert.equal(pKin.flowDirection, 1, 'holes drift with +I');
  assert.equal(nKin.pileSide, pKin.pileSide, 'same pile face (q and v both reverse)');
  assert.equal(nKin.pileSide, -1, 'I>0,B>0 piles toward −Y');
});

test('flipping B reverses the Lorentz pile side', () => {
  const pos = hallCarrierKinematics({ I: 1, B: 1, nType: true });
  const neg = hallCarrierKinematics({ I: 1, B: -1, nType: true });
  assert.equal(pos.pileSide, -neg.pileSide);
  assert.notEqual(pos.pileSide, 0);
});

test('particle sim keeps bulk flow and only mild Hall-side bias (not edge-glued)', () => {
  const root = createHallDemoEquipment({ tabletop: true });
  const state = {
    I: 1,
    B: 1,
    n: 1,
    d: 0.5,
    nType: true,
    paused: false,
    autoCam: false,
    showB: true,
  };
  // Warm up to a quasi-steady Hall distribution.
  for (let i = 0; i < 180; i += 1) root.userData.update(state, 1 / 60);
  const stats = root.userData.getCarrierStats();
  const kin = hallCarrierKinematics(state);

  // Electrons drift −X.
  assert.ok(stats.meanVx < -0.4, `expected bulk −X drift, meanVx=${stats.meanVx}`);
  // Mild bias toward Lorentz face, not full collapse onto the wall.
  assert.ok(
    Math.sign(stats.meanY) === kin.pileSide || Math.abs(stats.meanY) < 0.05,
    `meanY=${stats.meanY} should bias toward pileSide=${kin.pileSide}`,
  );
  assert.ok(Math.abs(stats.meanY) < 0.75, `meanY too extreme (edge glued?): ${stats.meanY}`);
  assert.ok(
    stats.edgeFraction < 0.55,
    `too many carriers stuck on the Hall face: edgeFraction=${stats.edgeFraction}`,
  );

  // B = 0 → bias collapses toward center, drift remains.
  for (let i = 0; i < 120; i += 1) root.userData.update({ ...state, B: 0 }, 1 / 60);
  const zeroB = root.userData.getCarrierStats();
  assert.ok(zeroB.meanVx < -0.4, `B=0 should keep drift, meanVx=${zeroB.meanVx}`);
  assert.ok(Math.abs(zeroB.meanY) < Math.abs(stats.meanY) + 0.08, 'B=0 should reduce Hall bias');
});

test('host-owned flag allows smooth carrier extrapolation so particles do not freeze', () => {
  const root = createHallDemoEquipment({ tabletop: true });
  const state = {
    I: 1,
    B: 1,
    n: 1,
    d: 0.5,
    nType: true,
    paused: false,
    autoCam: false,
    showB: true,
  };

  // Local path: carriers must drift.
  for (let i = 0; i < 60; i += 1) root.userData.update(state, 1 / 60);
  const local = root.userData.getCarrierStats();
  assert.ok(local.meanVx < -0.3, `local integrate stalled: meanVx=${local.meanVx}`);

  // Host-owned mode runs extrapolation between packs so carriers do not freeze.
  root.userData.setHostParticlesOwned(true);
  const beforeStats = root.userData.getCarrierStats();
  for (let i = 0; i < 60; i += 1) root.userData.update(state, 1 / 60);
  const afterStats = root.userData.getCarrierStats();
  assert.ok(afterStats.meanVx < -0.3, `host-owned extrapolation must maintain drift, meanVx=${afterStats.meanVx}`);

  // Applying a host pack resumes paint from backend data.
  const pack = new Float32Array(240 * 6);
  for (let i = 0; i < 240; i += 1) {
    const o = i * 6;
    pack[o] = (i / 240 - 0.5) * 4;
    pack[o + 1] = -0.2;
    pack[o + 2] = 0;
    pack[o + 3] = -1.4;
    pack[o + 4] = 0;
    pack[o + 5] = 0;
  }
  root.userData.applyHostParticles(pack, 6);
  const applied = root.userData.getCarrierStats();
  assert.ok(Math.abs(applied.meanY + 0.2) < 1e-6, `applied meanY=${applied.meanY}`);
  assert.ok(Math.abs(applied.meanVx + 1.4) < 1e-6, `applied meanVx=${applied.meanVx}`);
});

test('carrier concentration n dynamically scales rendered particle density drawRange', () => {
  const root = createHallDemoEquipment({ tabletop: true });
  const pointsMesh = root.children.find((child) => child.isPoints);
  assert.ok(pointsMesh, 'carrier Points mesh must exist');

  root.userData.update({ I: 1, B: 1, n: 0.3, d: 0.5, nType: true }, 0.016);
  const countLow = pointsMesh.geometry.drawRange.count;

  root.userData.update({ I: 1, B: 1, n: 2.5, d: 0.5, nType: true }, 0.016);
  const countHigh = pointsMesh.geometry.drawRange.count;

  assert.ok(countLow < countHigh, `low n (0.3) count (${countLow}) must be smaller than high n (2.5) count (${countHigh})`);
  assert.ok(countHigh / countLow >= 3.5, `density change ratio (${countHigh / countLow}) should be distinct (>3.5x)`);
});

test('Hall demo parameters: only magnetic field B controls B arrows; other parameters (I, n, d) control charge accumulation display', () => {
  const root = createHallDemoEquipment({ tabletop: true });

  // 1. Current I controls surface charge accumulation, but DOES NOT alter magnetic field B arrows
  root.userData.update({ I: 0, B: 1, n: 1, d: 0.5, nType: true }, 0.016);
  const zeroI = root.userData.getVisualStats();
  assert.equal(zeroI.posCharges, 0, 'I=0 must hide surface charges');
  assert.ok(zeroI.bArrows > 0, 'B=1 must still display B arrows even when I=0');

  root.userData.update({ I: 0.5, B: 1, n: 1, d: 0.5, nType: true }, 0.016);
  const lowI = root.userData.getVisualStats();

  root.userData.update({ I: 2.0, B: 1, n: 1, d: 0.5, nType: true }, 0.016);
  const highI = root.userData.getVisualStats();

  assert.ok(lowI.posCharges < highI.posCharges, 'Higher I must accumulate more surface charges');
  assert.equal(lowI.bArrows, highI.bArrows, 'Current I must NOT alter magnetic field arrow count');

  // 2. Magnetic field B controls B arrows and surface charge accumulation
  root.userData.update({ I: 1, B: 0, n: 1, d: 0.5, nType: true }, 0.016);
  const zeroB = root.userData.getVisualStats();
  assert.equal(zeroB.bArrows, 0, 'B=0 must hide B arrows');
  assert.equal(zeroB.posCharges, 0, 'B=0 must hide surface charges');

  root.userData.update({ I: 1, B: 0.5, n: 1, d: 0.5, nType: true }, 0.016);
  const lowB = root.userData.getVisualStats();

  root.userData.update({ I: 1, B: 2.0, n: 1, d: 0.5, nType: true }, 0.016);
  const highB = root.userData.getVisualStats();

  assert.ok(lowB.bArrows < highB.bArrows, 'Higher B must display more B arrows');
  assert.ok(lowB.posCharges < highB.posCharges, 'Higher B must accumulate more surface charges');

  // 3. Carrier concentration n: higher n decreases surface charge accumulation, but DOES NOT alter B arrows
  root.userData.update({ I: 1, B: 1, n: 0.4, d: 0.5, nType: true }, 0.016);
  const lowN = root.userData.getVisualStats();

  root.userData.update({ I: 1, B: 1, n: 2.5, d: 0.5, nType: true }, 0.016);
  const highN = root.userData.getVisualStats();

  assert.ok(lowN.posCharges > highN.posCharges, 'Higher n must decrease surface charges due to smaller U_H');
  assert.equal(lowN.bArrows, highN.bArrows, 'Carrier concentration n must NOT alter magnetic field arrows');
  assert.ok(lowN.drawCount < highN.drawCount, 'Higher n must increase internal carrier particle count');

  // 4. Sample thickness d: thicker sample decreases surface charge accumulation, but DOES NOT alter B arrows
  root.userData.update({ I: 1, B: 1, n: 1, d: 0.15, nType: true }, 0.016);
  const lowD = root.userData.getVisualStats();

  root.userData.update({ I: 1, B: 1, n: 1, d: 1.2, nType: true }, 0.016);
  const highD = root.userData.getVisualStats();

  assert.ok(lowD.posCharges > highD.posCharges, 'Thicker d must decrease surface charges due to smaller U_H');
  assert.equal(lowD.bArrows, highD.bArrows, 'Sample thickness d must NOT alter magnetic field arrows');
});

test('hologram canvas sizes match dense layout table', () => {
  const hallDemo = getHoloScreenLayoutSize({
    active: true,
    hud: { running: true, experiment: { id: 'hall_carrier_demo' } },
  });
  assert.deepEqual(hallDemo, { width: 1024, height: 540 });

  const menu = getHoloScreenLayoutSize({
    active: true,
    hud: { station: { experiments: [{}, {}, {}, {}] } },
  });
  assert.ok(menu.height >= 460);
});

test('selector surface stays menu-sized while display hosts experiment content', () => {
  const runningHud = {
    running: true,
    experiment: { id: 'hall_carrier_demo' },
    station: { experiments: [{}, {}, {}] },
  };
  const selector = getHoloScreenLayoutSize({
    active: true,
    hud: runningHud,
    surface: 'selector',
  });
  assert.ok(selector.height < 920);
  assert.ok(selector.height >= 460);

  const display = getHoloScreenLayoutSize({
    active: true,
    hud: runningHud,
    surface: 'display',
  });
  assert.deepEqual(display, { width: 1280, height: 760 });

  const displayIdle = getHoloScreenLayoutSize({
    active: true,
    hud: { running: false, station: { experiments: [{}, {}] } },
    surface: 'display',
  });
  assert.deepEqual(displayIdle, { width: 1280, height: 780 });
});

test('electro station menu hit testing correctly picks each of the 5 cards', () => {
  const station = {
    id: 'electro',
    experiments: [
      { id: 'electric_field', name: '静电场探索' },
      { id: 'faraday_induction', name: '法拉第电磁感应' },
      { id: 'induced_electric_field', name: '感生电场' },
      { id: 'hall_carrier_demo', name: '霍尔效应原理' },
      { id: 'hall_effect', name: '霍尔效应测磁' },
    ],
  };

  const layout = getHoloScreenLayoutSize({
    active: true,
    hud: { station, running: false },
    surface: 'selector',
  });

  const hits = [];
  const stubCtx = {
    clearRect() {}, fillRect() {}, strokeRect() {}, fillText() {},
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, arcTo() {}, fill() {}, stroke() {}, addColorStop() {},
    createLinearGradient() { return { addColorStop() {} }; },
  };

  const res = drawHoloScreen(stubCtx, layout.width, layout.height, {
    active: true,
    hud: { station, running: false },
    surface: 'selector',
    fullTitle: '电磁学实验台',
    enTitle: 'ELECTROMAGNETISM',
  });

  const cardHits = res.hits.filter((h) => h.action === 'start');
  assert.equal(cardHits.length, 5, 'electro station menu must produce 5 card hit regions');

  // Verify each card hit region maps to the expected expId
  const expectedIds = [
    'electric_field',
    'faraday_induction',
    'induced_electric_field',
    'hall_carrier_demo',
    'hall_effect',
  ];
  cardHits.forEach((hit, i) => {
    assert.equal(hit.expId, expectedIds[i]);
    // Pick center of card
    const u = (hit.x + hit.w / 2) / layout.width;
    const v = 1 - (hit.y + hit.h / 2) / layout.height;
    const picked = pickHoloScreen(u, v, layout.width, layout.height, res.hits);
    assert.ok(picked, `card ${i + 1} (${expectedIds[i]}) should be pickable`);
    assert.equal(picked.expId, expectedIds[i]);

    // The rear mesh is rotated by PI, so its local U is mirrored. The same
    // visual card must still start the same experiment when aimed from behind.
    const rearPicked = pickHoloScreen(1 - u, v, layout.width, layout.height, res.hits, -1);
    assert.ok(rearPicked, `rear card ${i + 1} (${expectedIds[i]}) should be pickable`);
    assert.equal(rearPicked.expId, expectedIds[i]);
  });

  // Verify empty header click returns null (no fallback to hall_effect)
  const headerU = 0.5;
  const headerV = 1 - 40 / layout.height; // top header region
  const headerPick = pickHoloScreen(headerU, headerV, layout.width, layout.height, res.hits);
  assert.equal(headerPick, null, 'clicking empty header area must return null');
});

test('Hall effect solenoid and Helmholtz theoretical curves match simulated measurements', () => {
  const station = { id: 'electro', name: '电磁学实验台' };
  const experiment = { id: 'hall_effect', name: '霍尔效应与磁场测量' };

  // Solenoid test with default params (L = 30cm, N = 1000, Im = 0.5A, Is = 5mA, K = 220)
  const solenoidData = {
    target: 'solenoid',
    Im: 0.5,
    Is: 5.0,
    solenoidLength: 30,
    turns: 1000,
    direction: 1,
    showCurve: true,
    showFit: true,
    wiring: { energized: true, target: 'solenoid' },
    records: [
      { target: 'solenoid', pos: 0, vh: 2.2936, Is: 5.0, Im: 0.5, turns: 1000, direction: 1, hallK: 220 },
      { target: 'solenoid', pos: 5, vh: 2.2900, Is: 5.0, Im: 0.5, turns: 1000, direction: 1, hallK: 220 },
    ],
  };

  const layout = getHoloScreenLayoutSize({ active: true, hud: { station, experiment, running: true, data: solenoidData }, surface: 'display' });
  const stubCtx = {
    clearRect() {}, fillRect() {}, strokeRect() {}, fillText() {},
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, arcTo() {}, fill() {}, stroke() {}, addColorStop() {},
    createLinearGradient() { return { addColorStop() {} }; },
    measureText() { return { width: 50 }; },
  };

  // Drawing the screen must execute without error
  const res = drawHoloScreen(stubCtx, layout.width, layout.height, {
    active: true,
    hud: { station, experiment, running: true, data: solenoidData },
    surface: 'display',
    fullTitle: '电磁学实验台',
    enTitle: 'ELECTROMAGNETISM',
  });
  assert.ok(res);
});


