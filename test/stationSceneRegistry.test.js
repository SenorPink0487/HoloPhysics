import test from 'node:test';
import assert from 'node:assert/strict';

import { STATION_SCENE_MODULES } from '../src/scene/stations/registry.js';

test('scene station registry exposes one factory per experiment category', () => {
  assert.deepEqual(Object.keys(STATION_SCENE_MODULES), [
    'mechanics',
    'optics',
    'electro',
    'thermo',
    'chem',
  ]);
  Object.values(STATION_SCENE_MODULES).forEach((createStationEquipment) => {
    assert.equal(typeof createStationEquipment, 'function');
  });
});
