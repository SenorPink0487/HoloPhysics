import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defineInteractionTarget,
  findInteractionHost,
  INTERACTION_KIND,
  interactionKind,
  isInteractionKind,
} from '../src/runtime/interactionContract.js';
import {
  createExperimentHandlers,
  defineStationExperimentModule,
} from '../src/experiments/contract.js';

test('interaction contract resolves an explicit host instead of a raycast child', () => {
  const host = { userData: {}, parent: null };
  const child = { userData: {}, parent: host };
  defineInteractionTarget(host, {
    kind: INTERACTION_KIND.HOLO_DISPLAY,
    role: 'holo_display',
    stationId: 'electro',
  });

  assert.equal(findInteractionHost(child), host);
  assert.equal(interactionKind(host), INTERACTION_KIND.HOLO_DISPLAY);
  assert.equal(isInteractionKind(host, INTERACTION_KIND.HOLO_DISPLAY), true);
  assert.equal(host.userData.stationId, 'electro');
});

test('legacy metadata stays readable only for active interactive hosts', () => {
  const decorativeChild = { userData: { type: 'holo_display' }, parent: null };
  const host = { userData: { type: 'holo_display', interactive: true }, parent: null };
  assert.equal(interactionKind(decorativeChild), null);
  assert.equal(interactionKind(host), INTERACTION_KIND.HOLO_DISPLAY);
});

test('experiment handler contract validates station identity and hook shape', () => {
  const module = defineStationExperimentModule({
    station: { id: 'demo' },
    createHandlers: () => ({ initData: () => ({}) }),
  });
  assert.equal(createExperimentHandlers(module, {}).initData().constructor, Object);
  assert.throws(
    () => createExperimentHandlers({ station: { id: 'bad' }, createHandlers: () => ({ simulate: true }) }, {}),
    /handler\.simulate must be a function/,
  );
});
