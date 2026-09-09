import test from 'node:test';
import assert from 'node:assert/strict';

import { createContentScreenRegistry } from '../src/runtime/contentScreenReuse.js';

test('one content screen surface is reused by experiments in a category', () => {
  const registry = createContentScreenRegistry();
  const screen = { id: 'mechanics-screen' };

  assert.equal(registry.register('mechanics', screen), screen);
  assert.equal(registry.bind('mechanics', 'pendulum').changed, true);
  const second = registry.bind('mechanics', 'collision');

  assert.equal(second.changed, true);
  assert.equal(second.reused, true);
  assert.equal(second.screen, screen);
  assert.equal(registry.get('mechanics'), screen);
  assert.equal(registry.snapshot('mechanics').reuseCount, 1);
});

test('re-registering a category cannot replace its screen surface', () => {
  const registry = createContentScreenRegistry();
  registry.register('optics', { id: 'first' });

  assert.throws(
    () => registry.register('optics', { id: 'replacement' }),
    /already registered for category: optics/,
  );
});

test('release clears only the binding and keeps the surface available', () => {
  const registry = createContentScreenRegistry();
  const screen = { id: 'thermo-screen' };
  registry.register('thermo', screen);
  registry.bind('thermo', 'ideal-gas');

  assert.equal(registry.release('thermo'), true);
  assert.equal(registry.snapshot('thermo').activeExperimentId, null);
  assert.equal(registry.get('thermo'), screen);
});
