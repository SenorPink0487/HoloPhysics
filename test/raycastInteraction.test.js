import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveFrontmostInteraction, apparatusBeatsHolo } from '../src/raycastInteraction.js';

function object({ interactive = false, opacity = 1, visible = true, parent = null } = {}) {
  return {
    visible,
    parent,
    material: { visible: true, transparent: opacity < 1, opacity },
    userData: { interactive },
  };
}

function resolveInteractive(source) {
  let current = source;
  while (current && !current.userData?.interactive) current = current.parent;
  return current?.userData?.interactive ? current : null;
}

test('a front non-interactive surface blocks an interactive object behind it', () => {
  const wall = object();
  const dial = object({ interactive: true });
  const result = resolveFrontmostInteraction([
    { object: wall, distance: 1 },
    { object: dial, distance: 2 },
  ], { resolveInteractive });

  assert.equal(result.hit.object, wall);
  assert.equal(result.target, null);
});

test('the front interactive surface is selected', () => {
  const equipment = object({ interactive: true });
  const visiblePart = object({ parent: equipment });
  const result = resolveFrontmostInteraction([
    { object: visiblePart, distance: 1 },
  ], { resolveInteractive });

  assert.equal(result.target, equipment);
});

test('transparent decoration is skipped but an interactive hit proxy is retained', () => {
  const decoration = object({ opacity: 0 });
  const proxy = object({ interactive: true, opacity: 0 });
  const result = resolveFrontmostInteraction([
    { object: decoration, distance: 0.5 },
    { object: proxy, distance: 1 },
  ], { resolveInteractive });

  assert.equal(result.hit.object, proxy);
  assert.equal(result.target, proxy);
});

test('an out-of-range front target blocks interaction instead of selecting behind it', () => {
  const front = object({ interactive: true });
  const behind = object({ interactive: true });
  const result = resolveFrontmostInteraction([
    { object: front, distance: 5 },
    { object: behind, distance: 6 },
  ], {
    resolveInteractive,
    withinInteractDist: (_target, distance) => distance <= 3,
  });

  assert.equal(result.hit.object, front);
  assert.equal(result.target, null);
});

test('an explicitly hit UI control has mouse-like priority over scene geometry', () => {
  const apparatus = object();
  const holo = object({ interactive: true });
  const priorityInteraction = {
    hit: { object: holo, distance: 2 },
    target: holo,
  };
  const result = resolveFrontmostInteraction([
    { object: apparatus, distance: 1 },
  ], {
    resolveInteractive,
    priorityInteraction,
  });

  assert.equal(result, priorityInteraction);
  assert.equal(result.target, holo);
});

test('a specific apparatus control wins inside an interactive front layer', () => {
  const consoleHitBox = object({ interactive: true, opacity: 0 });
  const button = object({ interactive: true });
  const behindWallControl = object({ interactive: true });
  const result = resolveFrontmostInteraction([
    { object: consoleHitBox, distance: 1 },
    { object: button, distance: 1.04 },
    { object: behindWallControl, distance: 2 },
  ], {
    resolveInteractive,
    preferInteractive: (nearHits) => (
      nearHits.find((hit) => hit.object === button)?.object || null
    ),
  });

  assert.equal(result.hit.object, consoleHitBox);
  assert.equal(result.target, button);
});

test('closer charge beats content-screen control on the same ray', () => {
  const charge = { target: { id: 'charge' }, hit: { distance: 1.2 } };
  const holo = { target: { id: 'holo' }, hit: { distance: 2.5 } };
  assert.equal(apparatusBeatsHolo(charge, holo), true);
});

test('content screen clearly in front of charge keeps UI priority', () => {
  const charge = { target: { id: 'charge' }, hit: { distance: 3.0 } };
  const holo = { target: { id: 'holo' }, hit: { distance: 1.5 } };
  assert.equal(apparatusBeatsHolo(charge, holo), false);
});

test('charge slightly behind glass still beats holo within tight margin', () => {
  const charge = { target: { id: 'charge' }, hit: { distance: 2.03 } };
  const holo = { target: { id: 'holo' }, hit: { distance: 2.0 } };
  assert.equal(apparatusBeatsHolo(charge, holo, 0.04), true);
  assert.equal(apparatusBeatsHolo(charge, holo, 0.02), false);
});

test('grazing probe farther than the screen does not beat content UI', () => {
  const probe = { target: { id: 'probe' }, hit: { distance: 2.2 } };
  const holo = { target: { id: 'holo' }, hit: { distance: 2.0 } };
  assert.equal(apparatusBeatsHolo(probe, holo), false);
});
