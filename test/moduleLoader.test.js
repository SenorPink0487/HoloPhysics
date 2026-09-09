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
  assert.ok(LAB_CATALOG.mechanics);
  assert.ok(findExperiment('pendulum'));
  assert.deepEqual(cachedModuleKeys(), []);
  assert.equal(hasCachedModule('station:mechanics'), false);
  assert.equal(hasCachedModule('experiment:mechanics'), false);
});

test('concurrent station loads share one Promise', async () => {
  clearModulePromises();
  const a = loadStationModule('mechanics');
  const b = loadStationModule('mechanics');
  assert.equal(a, b);
  const [modA, modB] = await Promise.all([a, b]);
  assert.equal(modA, modB);
  assert.equal(typeof (modA.createStationEquipment || modA.default), 'function');
  assert.equal(hasCachedModule('station:mechanics'), true);
  assert.equal(hasCachedModule('experiment:mechanics'), false);
});

test('experiment module load is separate from station scene load', async () => {
  clearModulePromises();
  await loadStationModule('thermo');
  assert.equal(hasCachedModule('station:thermo'), true);
  assert.equal(hasCachedModule('experiment:thermo'), false);

  const first = loadExperimentModule('ideal-gas', 'thermo');
  const second = loadStationExperimentModule('thermo');
  assert.equal(first, second);
  const mod = await first;
  assert.ok(mod.station);
  assert.equal(hasCachedModule('experiment:thermo'), true);
});

test('chemistry modules are also intent-loaded, not eagerly cached by catalog import', async () => {
  clearModulePromises();
  assert.equal(hasCachedModule('station:chem'), false);
  assert.equal(hasCachedModule('experiment:chem'), false);

  const station = await loadStationModule('chem');
  assert.equal(typeof station.createStationEquipment, 'function');
  assert.equal(hasCachedModule('experiment:chem'), false);

  const experiment = await loadStationExperimentModule('chem');
  assert.equal(typeof experiment.createHandlers, 'function');
});

test('unknown station rejects without caching', async () => {
  clearModulePromises();
  await assert.rejects(() => loadStationModule('nope'), /Unknown station/);
  assert.equal(hasCachedModule('station:nope'), false);
});
