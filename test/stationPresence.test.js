import test from 'node:test';
import assert from 'node:assert/strict';
import { createStationPresence } from '../src/runtime/stationPresence.js';

function makeStub(id) {
  const root = {
    name: id,
    visible: true,
    matrixAutoUpdate: true,
    children: [],
    updateMatrix() {},
  };
  let mode = 'live';
  let showcaseCount = 0;
  const equipment = {
    showcase() { mode = 'showcase'; showcaseCount += 1; },
    shutdown() { mode = 'off'; },
    suspend() { mode = 'off'; },
    resume() { mode = 'live'; },
    get mode() { return mode; },
    get showcaseCount() { return showcaseCount; },
  };
  return { root, equipment, modeRef: () => mode, showcaseCount: () => showcaseCount };
}

test('cold stations stay visible with clear tabletops; only one station is hot', () => {
  const optics = makeStub('optics');
  const electro = makeStub('electro');
  const presence = createStationPresence({
    stationScenes: { optics, electro },
  });
  presence.coldBootAll();

  assert.equal(presence.getHotStation(), null);
  // Room must not look empty — cold roots stay visible.
  assert.equal(optics.root.visible, true);
  assert.equal(electro.root.visible, true);
  assert.equal(optics.modeRef(), 'off');
  assert.equal(electro.modeRef(), 'off');

  presence.setHotStation('optics');
  assert.equal(presence.getHotStation(), 'optics');
  assert.equal(optics.root.visible, true);
  assert.equal(electro.root.visible, true);
  assert.equal(electro.modeRef(), 'off');

  presence.setHotStation('electro');
  assert.equal(presence.getHotStation(), 'electro');
  assert.equal(optics.root.visible, true);
  assert.equal(electro.root.visible, true);
  assert.equal(optics.modeRef(), 'off');

  presence.setHotStation(null);
  assert.equal(presence.getHotStation(), null);
  assert.equal(optics.root.visible, true);
  assert.equal(electro.root.visible, true);
});

test('setHotStation ignores unknown ids', () => {
  const optics = makeStub('optics');
  const presence = createStationPresence({ stationScenes: { optics } });
  presence.coldBootAll();
  presence.setHotStation('nope');
  assert.equal(presence.getHotStation(), null);
  assert.equal(optics.root.visible, true);
});

test('setHotStation does not re-showcase already-idle benches (first-open hitch)', () => {
  const optics = makeStub('optics');
  const electro = makeStub('electro');
  const thermo = makeStub('thermo');
  const presence = createStationPresence({
    stationScenes: { optics, electro, thermo },
  });
  presence.coldBootAll();
  const electroShowcasesAfterBoot = electro.showcaseCount();
  const thermoShowcasesAfterBoot = thermo.showcaseCount();

  // Opening optics must not re-run showcase on idle electro/thermo tables.
  presence.setHotStation('optics');
  assert.equal(electro.showcaseCount(), electroShowcasesAfterBoot);
  assert.equal(thermo.showcaseCount(), thermoShowcasesAfterBoot);
});

test('setHotStation click frame is pure bookkeeping (no freeze walks)', () => {
  // Dense tree — presence must never walk it.
  function makeDeepStub(id, depth = 80) {
    const stub = makeStub(id);
    let node = stub.root;
    for (let i = 0; i < depth; i += 1) {
      const child = {
        name: `${id}-${i}`,
        matrixAutoUpdate: true,
        children: [],
        updateMatrix() {},
      };
      node.children.push(child);
      node = child;
    }
    return stub;
  }
  const optics = makeDeepStub('optics', 120);
  const presence = createStationPresence({ stationScenes: { optics } });
  presence.coldBootAll();

  const t0 = performance.now();
  presence.setHotStation('optics');
  const clickMs = performance.now() - t0;
  assert.ok(clickMs < 4, `setHotStation click frame too slow: ${clickMs.toFixed(2)}ms`);
  assert.equal(presence.getHotStation(), 'optics');
  // Presence never touches matrixAutoUpdate — still true on root.
  assert.equal(optics.root.matrixAutoUpdate, true);
});

test('re-hot same station is no-op for idle showcase thrash', () => {
  const optics = makeStub('optics');
  const presence = createStationPresence({ stationScenes: { optics } });
  presence.coldBootAll();
  presence.setHotStation('optics');
  const n = optics.showcaseCount();
  // Same hot id again must not force showcase on others / re-enter cold.
  presence.setHotStation('optics');
  assert.equal(optics.showcaseCount(), n);
  assert.equal(presence.getHotStation(), 'optics');
});
