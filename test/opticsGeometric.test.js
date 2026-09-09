import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  cauchyIOR,
  criticalAngleDeg,
  reflect,
  refract,
  snellRatio,
  spectrumWavelengths,
  wavelengthToRGB,
} from '../src/guangxue/opticsCore.js';
import { createGeometry, isMirrorShape } from '../src/guangxue/shapes.js';
import {
  GEOMETRIC_EXPERIMENTS,
  GEOMETRIC_EXP_IDS,
  REFLECTION_MODULES,
  REFRACTION_MODULES,
  isGeometricOpticsExp,
} from '../src/guangxue/catalog.js';
import {
  createHandlers,
  formatOpticsRecordCell,
  geoOpticsRecordColumns,
  station,
} from '../src/experiments/optics.js';

function createContext() {
  const toasts = [];
  let lastGeo = null;
  const ctx = {
    state: {
      stationId: 'optics',
      expId: 'reflection',
      stepIndex: 0,
      running: true,
      data: {},
    },
    equipment: {
      optics: {
        updateOptics: () => {},
        updateGeometric: (data) => {
          // Analytic mirror/dielectric readout mirroring source fallback
          const angle = Number(data.angle);
          const ior = Number(data.ior);
          const mode = data.opticsMode || data.mode;
          if (mode === 'mirror') {
            lastGeo = {
              theta1: angle,
              theta2: angle,
              thetaReflect: angle,
              thetaRefract: null,
            };
            return lastGeo;
          }
          const s = (1 / ior) * Math.sin((angle * Math.PI) / 180);
          const th2 = Math.abs(s) <= 1 ? (Math.asin(s) * 180) / Math.PI : null;
          lastGeo = {
            theta1: angle,
            theta2: th2,
            thetaReflect: angle,
            thetaRefract: th2,
          };
          return lastGeo;
        },
        setMode: () => {},
        clearIdentifyVisuals: () => {},
        mouseDrag: { movementX: 0 },
      },
    },
    toast: (m) => toasts.push(m),
    pushHud: () => {},
    setStep: (id) => {
      const steps = ['setup', 'observe', 'measure', 'record', 'result'];
      const idx = steps.indexOf(id);
      if (idx >= 0) ctx.state.stepIndex = idx;
    },
    currentStep: () => {
      const steps = [
        { id: 'setup' }, { id: 'observe' }, { id: 'measure' }, { id: 'record' }, { id: 'result' },
      ];
      return steps[ctx.state.stepIndex] || null;
    },
    toasts,
  };
  return ctx;
}

test('station catalog: 1.1–1.4 and 2.1–2.4 are modules, not separate cards', () => {
  const ids = station.experiments.map((e) => e.id);
  assert.deepEqual(
    ids.filter((id) => id !== 'multi_slit_diffraction'),
    ['reflection', 'refraction', 'dispersion', 'lens'],
  );
  assert.ok(ids.includes('multi_slit_diffraction'));
  assert.equal(GEOMETRIC_EXPERIMENTS.length, 4);
  assert.equal(GEOMETRIC_EXP_IDS.length, 4);
  assert.equal(REFLECTION_MODULES.length, 4);
  assert.equal(REFRACTION_MODULES.length, 4);
  assert.ok(!ids.includes('reflect-law'));
  assert.ok(!ids.includes('refract-snell'));
});

test('Snell ratio and critical angle sanity', () => {
  // n=1.5, θ1=30° → θ2 = arcsin(sin30/1.5)
  const th1 = 30;
  const th2 = (Math.asin(Math.sin((th1 * Math.PI) / 180) / 1.5) * 180) / Math.PI;
  const ratio = snellRatio(th1, th2);
  assert.ok(Math.abs(ratio - 1.5) < 1e-9);
  const tc = criticalAngleDeg(1.5, 1);
  assert.ok(Math.abs(tc - (Math.asin(1 / 1.5) * 180) / Math.PI) < 1e-9);
  assert.equal(criticalAngleDeg(0.9, 1), null);
});

test('refract returns null under TIR', () => {
  const I = new THREE.Vector3(0, -1, 0); // upward-normal face, from inside
  // Ray in denser medium toward air at grazing incidence
  const nGlass = 1.5;
  const dir = new THREE.Vector3(Math.sin(1.2), Math.cos(1.2), 0).normalize(); // large angle from -normal
  const N = new THREE.Vector3(0, 1, 0);
  // Inside glass (n1=1.5) going to air (n2=1): force inside path by passing n1>n2 with cosi setup
  const T = refract(dir, N, nGlass, 1.0);
  // Depending on angle may or may not TIR — check 80° from normal
  const dir2 = new THREE.Vector3(Math.sin((80 * Math.PI) / 180), -Math.cos((80 * Math.PI) / 180), 0).normalize();
  const T2 = refract(dir2, N, nGlass, 1.0);
  assert.equal(T2, null);
  // Normal incidence transmits
  const T3 = refract(new THREE.Vector3(0, -1, 0), N, 1.0, nGlass);
  assert.ok(T3);
  assert.ok(Math.abs(T3.y + 1) < 1e-6 || T3.y < 0);
  void I; void T;
});

test('reflect law: angle of incidence equals angle of reflection', () => {
  const N = new THREE.Vector3(0, 1, 0);
  const I = new THREE.Vector3(Math.sin(0.5), -Math.cos(0.5), 0).normalize();
  const R = reflect(I, N);
  const ai = Math.acos(Math.min(1, Math.abs(I.dot(N))));
  const ar = Math.acos(Math.min(1, Math.abs(R.dot(N))));
  assert.ok(Math.abs(ai - ar) < 1e-9);
});

test('Cauchy IOR increases toward violet', () => {
  const nRed = cauchyIOR(1.52, 650, 1);
  const nViolet = cauchyIOR(1.52, 420, 1);
  assert.ok(nViolet > nRed);
  assert.ok(Math.abs(cauchyIOR(1.52, 589, 1) - 1.52) < 0.002);
});

test('wavelengthToRGB and spectrum sampling', () => {
  const c = wavelengthToRGB(550);
  assert.ok(c.g > 0.5);
  const ws = spectrumWavelengths(5);
  assert.equal(ws.length, 5);
  assert.equal(ws[0], 400);
  assert.equal(ws[4], 700);
});

test('shapes: mirror detection and geometry creation', () => {
  assert.equal(isMirrorShape('mirror'), true);
  assert.equal(isMirrorShape('prism'), false);
  for (const kind of ['prism', 'block', 'sphere', 'cylinder', 'mirror', 'mirror-convex']) {
    const g = createGeometry(kind);
    assert.ok(g.attributes.position.count > 0);
    g.dispose();
  }
});

test('geo handlers: reflection modules 1.1–1.4 + record/complete', () => {
  const ctx = createContext();
  const handlers = createHandlers(ctx);
  ctx.state.expId = 'reflection';
  ctx.state.data = handlers.initData('reflection');
  assert.equal(ctx.state.data.mode, 'geometric');
  assert.equal(ctx.state.data.opticsMode, 'mirror');
  assert.equal(ctx.state.data.moduleId, 'observe');
  assert.equal(ctx.state.data.moduleCode, '1.1');

  assert.equal(handlers.onUiAction('optics-geo-module', { module: 'law' }), true);
  assert.equal(ctx.state.data.moduleId, 'law');
  assert.equal(ctx.state.data.moduleCode, '1.2');
  assert.equal(ctx.state.data.angle, 40);

  assert.equal(handlers.onUiAction('optics-geo-set', { key: 'angle', value: 40 }), true);
  assert.equal(handlers.onUiAction('optics-geo-record'), true);
  assert.equal(ctx.state.data.records.length, 1);
  const row = ctx.state.data.records[0];
  assert.ok(Math.abs(row.theta1 - row.theta2) < 0.01);
  assert.ok(String(row.ratio).includes('θᵢ'));
  assert.ok(String(row.note).includes('1.2'));

  assert.equal(handlers.onUiAction('optics-geo-module', { module: 'tilt' }), true);
  assert.equal(ctx.state.data.moduleCode, '1.4');
  assert.equal(ctx.state.data.rotate, 20);

  assert.equal(handlers.onUiAction('optics-geo-complete'), true);
  assert.equal(ctx.state.data.completed, true);
});

test('geo handlers: refraction modules + snell record', () => {
  const ctx = createContext();
  const handlers = createHandlers(ctx);
  ctx.state.expId = 'refraction';
  ctx.state.data = handlers.initData('refraction');
  assert.equal(ctx.state.data.moduleCode, '2.1');
  handlers.onUiAction('optics-geo-module', { module: 'snell' });
  assert.equal(ctx.state.data.moduleCode, '2.2');
  assert.equal(ctx.state.data.opticsMode, 'dielectric');
  handlers.onUiAction('optics-geo-set', { key: 'angle', value: 30 });
  handlers.onUiAction('optics-geo-set', { key: 'ior', value: 1.5 });
  handlers.onUiAction('optics-geo-record');
  const row = ctx.state.data.records[0];
  assert.ok(Number(row.ratio) > 1.4 && Number(row.ratio) < 1.6);
  assert.ok(String(row.note).includes('2.2'));
});

test('geo record columns and cell formatting', () => {
  const colsR = geoOpticsRecordColumns('reflection');
  assert.ok(colsR.some((c) => c.key === 'deltaTheta'));
  const colsD = geoOpticsRecordColumns('refraction');
  assert.ok(colsD.some((c) => c.key === 'ratio'));
  assert.equal(formatOpticsRecordCell({ theta1: 12.34 }, 'theta1'), '12.3');
  assert.equal(formatOpticsRecordCell({ tir: true, theta2: null }, 'theta2'), 'TIR');
});

test('isGeometricOpticsExp helper', () => {
  assert.equal(isGeometricOpticsExp('reflection'), true);
  assert.equal(isGeometricOpticsExp('dispersion'), true);
  assert.equal(isGeometricOpticsExp('reflect-law'), false);
  assert.equal(isGeometricOpticsExp('multi_slit_diffraction'), false);
});
