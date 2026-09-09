import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createGeometricOpticsRig,
  GEO_HOST_SCALE,
} from '../src/guangxue/geometricRig.js';

test('geometric rig builds source island and traces rays after host scale', () => {
  const scene = new THREE.Scene();
  const rig = createGeometricOpticsRig();
  rig.scale.setScalar(GEO_HOST_SCALE);
  rig.position.set(4.2, 0.93 + 1.35 * GEO_HOST_SCALE, -2.8);
  scene.add(rig);

  const api = rig.userData.api;
  assert.ok(api);

  // Bench + sample only — host room owns floor/walls (no geo-lab-floor island).
  const names = [];
  rig.traverse((o) => { if (o.name) names.push(o.name); });
  assert.ok(!names.includes('geo-lab-floor'), 'source room floor must not be attached on host');
  assert.ok(names.includes('geo-optical-bench') || names.includes('geo-ray-box'));

  const snap = api.applyParams({
    shape: 'prism',
    angle: 40,
    rayCount: 3,
    ior: 1.52,
    dispersion: false,
    showReflect: true,
    mode: 'dielectric',
    force: true,
  });
  assert.ok(Number.isFinite(snap.theta1));
  assert.ok(snap.theta2 == null || Number.isFinite(snap.theta2));

  // Rays group should contain beam/line children after update
  const rayGroup = rig.getObjectByName('geo-rays');
  assert.ok(rayGroup);
  assert.ok(rayGroup.children.length > 0, 'expected traced ray geometry');

  // Mirror mode also produces rays
  api.applyParams({ shape: 'mirror', mode: 'mirror', angle: 35, rayCount: 2, force: true });
  assert.ok(rayGroup.children.length > 0);

  // Dispersion multi-wavelength
  api.applyParams({
    shape: 'prism',
    mode: 'dielectric',
    angle: 48,
    rayCount: 7,
    dispersion: true,
    dispersionStrength: 0.85,
    force: true,
  });
  assert.ok(rayGroup.children.length > 3, 'dispersion should spawn many segments');
});

test('host scale keeps source proportions readable', () => {
  assert.ok(GEO_HOST_SCALE >= 0.18 && GEO_HOST_SCALE <= 0.28);
});

test('applyParams defers full ray rebuild for experiment switch', () => {
  const scene = new THREE.Scene();
  const rig = createGeometricOpticsRig();
  scene.add(rig);
  const api = rig.userData.api;

  api.applyParams({
    shape: 'mirror', mode: 'mirror', angle: 35, rayCount: 1, force: true,
  });
  const rayGroup = rig.getObjectByName('geo-rays');
  assert.ok(rayGroup.children.length > 0);

  // Switch-like call: mesh updates deferred — beams cleared, pending flag set
  api.applyParams({
    shape: 'prism', mode: 'dielectric', angle: 40, rayCount: 2, ior: 1.52,
  }, { deferRays: true });
  assert.equal(api.raysPending, true);
  assert.equal(rayGroup.children.length, 0, 'stale beams cleared on deferred switch');

  const snap = api.flushDeferredRays();
  assert.equal(api.raysPending, false);
  assert.ok(rayGroup.children.length > 0, 'flush rebuilds rays');
  assert.ok(Number.isFinite(snap.theta1));

  // Matching signature after flush must be free (no pending)
  api.applyParams({
    shape: 'prism', mode: 'dielectric', angle: 40, rayCount: 2, ior: 1.52,
  }, { deferRays: true });
  assert.equal(api.raysPending, false);
  assert.ok(rayGroup.children.length > 0, 'signature match keeps existing rays');
});

test('completed default rays survive close and restore without a rebuild', () => {
  const rig = createGeometricOpticsRig();
  const api = rig.userData.api;
  const rayGroup = rig.getObjectByName('geo-rays');
  const mirror = {
    shape: 'mirror', mode: 'mirror', angle: 35, height: 0, rayCount: 2, ior: 1.52,
    dispersion: false, dispersionStrength: 0.6, rotate: 0, showReflect: true,
  };
  const prism = {
    shape: 'prism', mode: 'dielectric', angle: 48, height: 0, rayCount: 7, ior: 1.52,
    dispersion: true, dispersionStrength: 0.85, rotate: 0, showReflect: true,
  };

  api.applyParams(mirror, { force: true });
  const mirrorRayCount = rayGroup.children.length;
  api.cancelDeferredRays();
  assert.equal(rayGroup.children.length, 0, 'close parks active rays off-scene');
  assert.ok(api.rayCacheSize >= 1);

  api.applyParams(prism, { force: true });
  api.cancelDeferredRays();
  const cachedBeforeRestore = api.rayCacheSize;

  api.applyParams(mirror, { deferRays: true });
  assert.equal(api.raysPending, false, 'cached signature requires no deferred trace');
  assert.equal(rayGroup.children.length, mirrorRayCount);
  assert.equal(api.rayCacheSize, cachedBeforeRestore - 1);
});
