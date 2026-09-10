import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearModulePromises,
  cachedModuleKeys,
  hasCachedModule,
  loadStationModule,
  loadStationExperimentModule,
  loadExperimentModule,
} from '../src/runtime/moduleLoader.js';
import { LAB_CATALOG, findExperiment } from '../src/runtime/catalog.js';

test('catalog import does not populate module loader cache', () => {
  clearModulePromises();
  assert.ok(LAB_CATALOG.electro);
  assert.ok(findExperiment('hall_effect'));
  assert.deepEqual(cachedModuleKeys(), []);
  assert.equal(hasCachedModule('station:electro'), false);
  assert.equal(hasCachedModule('experiment:electro'), false);
});

test('concurrent station loads share one Promise', async () => {
  clearModulePromises();
  const a = loadStationModule('electro');
  const b = loadStationModule('electro');
  assert.equal(a, b);
  const [modA, modB] = await Promise.all([a, b]);
  assert.equal(modA, modB);
  assert.equal(typeof (modA.createStationEquipment || modA.default), 'function');
  assert.equal(hasCachedModule('station:electro'), true);
  assert.equal(hasCachedModule('experiment:electro'), false);
});

test('experiment module load is separate from station scene load', async () => {
  clearModulePromises();
  await loadStationModule('electro');
  assert.equal(hasCachedModule('station:electro'), true);
  assert.equal(hasCachedModule('experiment:electro'), false);

  const first = loadExperimentModule('hall_effect', 'electro');
  const second = loadStationExperimentModule('electro');
  assert.equal(first, second);
  const mod = await first;
  assert.ok(mod.station);
  assert.equal(hasCachedModule('experiment:electro'), true);
});

test('unknown station rejects without caching', async () => {
  clearModulePromises();
  await assert.rejects(() => loadStationModule('nope'), /Unknown station/);
  assert.equal(hasCachedModule('station:nope'), false);
});
