import test from 'node:test';
import assert from 'node:assert/strict';

import { createArInteractionController } from '../src/arInteraction.js';

function createHands() {
  return {
    Left: {
      visible: true,
      trackingVisible: true,
      openPalm: false,
      palmNdc: { x: -0.2, y: 0 },
      ndc: { x: -0.2, y: 0 },
      lockedTarget: null,
      hoverTarget: null,
      liveTarget: null,
      raycaster: null,
    },
    Right: {
      visible: true,
      trackingVisible: true,
      openPalm: false,
      palmNdc: { x: 0.2, y: 0 },
      ndc: { x: 0.2, y: 0 },
      lockedTarget: null,
      hoverTarget: null,
      liveTarget: null,
      raycaster: null,
    },
  };
}

test('single-hand empty pinch looks around; equipment pinch manipulates', () => {
  const hands = createHands();
  const events = [];
  const looks = [];
  const controller = createArInteractionController({
    getHandState: (label) => hands[label],
    beginManipulation: (event) => {
      if (!event?.target) return false;
      events.push(['begin', event.target]);
      return true;
    },
    updateManipulation: (event) => events.push(['update', event.dragged]),
    endManipulation: (event) => events.push(['end', event.dragged]),
    onLook: (dx, dy) => looks.push([dx, dy]),
    lookOptions: {
      minCutoff: 10,
      beta: 0,
      outputFollow: 120,
      sensitivity: 1,
      maxStepPx: 200,
    },
  });
  controller.setEnabled(true);
  assert.equal(controller.update(0).phase, 'idle');

  // First samples seed the look filter without rotating.
  controller.onPinchStart({ hand: 'Right', target: null });
  assert.equal(controller.update(0).phase, 'looking');
  assert.equal(looks.length, 0);

  // Continuous aim motion is smoothed across animation frames.
  hands.Right.ndc.x = 0.35;
  controller.update(16);
  controller.update(32);
  assert.ok(looks.length > 0, 'look should emit smoothed deltas while aim moves');
  assert.ok(looks.some(([dx]) => dx > 0), 'moving aim right should look right');
  controller.onPinchEnd({ hand: 'Right' });
  assert.equal(controller.isLooking(), false);

  const dial = { id: 'dial' };
  controller.onPinchStart({ hand: 'Left', target: dial });
  assert.equal(controller.update(40).phase, 'manipulating');
  controller.onPinchMove({ hand: 'Left', target: dial, dx: 9, dy: 0 });
  controller.onPinchEnd({ hand: 'Left' });
  assert.deepEqual(events, [['begin', dial], ['update', true], ['end', true]]);
});

test('dual pinch has highest priority and maps spread/close to forward/back', () => {
  const hands = createHands();
  const events = [];
  const looks = [];
  const controller = createArInteractionController({
    getHandState: (label) => hands[label],
    beginManipulation: (event) => {
      if (!event?.target) return false;
      events.push(['begin', event.target]);
      return true;
    },
    endManipulation: (event) => events.push(['end', event.cancelled]),
    onLook: (dx, dy) => looks.push([dx, dy]),
    dollyOptions: { gain: 10, deadZone: 0.001 },
    lookOptions: {
      minCutoff: 10,
      beta: 0,
      outputFollow: 120,
      sensitivity: 1,
      maxStepPx: 200,
    },
  });
  controller.setEnabled(true);

  const dial = { id: 'dial' };
  controller.onPinchStart({ hand: 'Right', target: dial });
  assert.equal(controller.isManipulating(), true);

  // Second hand pinch preempts equipment interaction.
  controller.onPinchStart({ hand: 'Left', target: null });
  assert.equal(controller.isDualNavigating(), true);
  assert.equal(controller.isManipulating(), false);
  assert.deepEqual(events, [['begin', dial], ['end', true]]);

  // Baseline distance = 0.4
  assert.equal(controller.update(0).movement.forward, 0);

  // Hands spread apart → forward
  hands.Left.ndc.x = -0.35;
  hands.Right.ndc.x = 0.35;
  const spread = controller.update(16);
  assert.ok(spread.movement.forward > 0, 'spreading hands should move forward');
  assert.equal(spread.phase, 'navigating');

  // Hands move closer → backward
  hands.Left.ndc.x = -0.15;
  hands.Right.ndc.x = 0.15;
  const close = controller.update(32);
  assert.ok(close.movement.forward < 0, 'closing hands should move backward');

  // Look events are ignored while dual-navigating.
  controller.onPinchMove({ hand: 'Right', dx: 20, dy: 0 });
  assert.deepEqual(looks, []);

  // Release one hand → remaining empty pinch becomes look.
  hands.Left.lockedTarget = null;
  hands.Left.hoverTarget = null;
  hands.Left.ndc.x = -0.15;
  controller.onPinchEnd({ hand: 'Right' });
  assert.equal(controller.isDualNavigating(), false);
  assert.equal(controller.isLooking(), true);
  controller.update(48); // seed filter
  hands.Left.ndc.x = 0.1;
  controller.update(64);
  controller.update(80);
  assert.ok(looks.some(([dx]) => dx > 0), 'remaining hand should resume smoothed look');
});

test('dual pinch responds to slow, filtered hand separation', () => {
  const hands = createHands();
  const controller = createArInteractionController({
    getHandState: (label) => hands[label],
  });
  controller.setEnabled(true);
  controller.onPinchStart({ hand: 'Left', target: null });
  controller.onPinchStart({ hand: 'Right', target: null });
  controller.update(0);

  // A one-thousandth NDC increase is a deliberate but slow movement after
  // the hand-tracking filter; it must not be swallowed by the dolly dead zone.
  hands.Left.ndc.x = -0.2006;
  hands.Right.ndc.x = 0.2006;
  assert.ok(controller.update(16).movement.forward > 0);
});

test('either hand can own empty-space look or equipment interaction', () => {
  const hands = createHands();
  let began = null;
  const controller = createArInteractionController({
    getHandState: (label) => hands[label],
    beginManipulation: (event) => { began = event.hand; },
  });
  controller.setEnabled(true);
  assert.equal(controller.onPinchStart({ hand: 'Left', target: null }), true);
  assert.equal(controller.isLooking(), true);
  controller.onPinchEnd({ hand: 'Left' });

  assert.equal(controller.onPinchStart({ hand: 'Right', target: { id: 'knob' } }), true);
  assert.equal(began, 'Right');
  assert.equal(controller.isManipulating(), true);
});

test('brief missing detections do not immediately report tracking lost', () => {
  const hands = createHands();
  const controller = createArInteractionController({
    getHandState: (label) => hands[label],
    trackingLossGraceMs: 400,
  });
  controller.setEnabled(true);
  assert.equal(controller.update(0).phase, 'idle');

  hands.Left.trackingVisible = false;
  hands.Right.trackingVisible = false;
  assert.equal(controller.update(250).phase, 'idle');
  assert.equal(controller.update(401).phase, 'tracking-lost');

  hands.Left.trackingVisible = true;
  assert.equal(controller.update(450).phase, 'idle');
});

test('look output is continuous and directionally stable while aim moves steadily', () => {
  const hands = createHands();
  const looks = [];
  const controller = createArInteractionController({
    getHandState: (label) => hands[label],
    onLook: (dx, dy) => looks.push(dx),
    lookOptions: {
      minCutoff: 1.2,
      beta: 0.4,
      outputFollow: 18,
      sensitivity: 1,
      maxStepPx: 80,
    },
  });
  controller.setEnabled(true);
  controller.onPinchStart({ hand: 'Right', target: null });

  // Seed filters.
  hands.Right.ndc.x = 0;
  controller.update(0);

  // Steady rightward motion over several frames.
  for (let i = 1; i <= 12; i += 1) {
    hands.Right.ndc.x = i * 0.02;
    controller.update(i * 16);
  }

  assert.ok(looks.length >= 6, 'should emit multiple look samples');
  assert.ok(looks.every((dx) => dx >= -0.5), 'should not thrash left while moving right');
  const peak = Math.max(...looks);
  const first = looks[0];
  assert.ok(peak > first, 'smoothed look should ramp instead of dumping full steps at once');
});

test('pinch on unmanipulable target falls back to look when beginManipulation returns false', () => {
  const hands = createHands();
  const controller = createArInteractionController({
    getHandState: (label) => hands[label],
    beginManipulation: () => false,
  });
  controller.setEnabled(true);
  controller.onPinchStart({ hand: 'Right', target: { id: 'background_wall' } });
  assert.equal(controller.isLooking(), true);
  assert.equal(controller.isManipulating(), false);
});

