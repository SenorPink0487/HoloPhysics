import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAND_DEPTH_MAX,
  HAND_DEPTH_MIN,
  OCCLUSION_FADE_MS,
  OCCLUSION_HOLD_MS,
  DynamicMotionGateVector3,
  GestureStabilizer,
  HandInteractionArbiter,
  KalmanAimFilter2D,
  MedianFilterScalar,
  MovementRearmGate,
  OneEuroScalar,
  PinchStateMachine,
  WorkerRecoveryPolicy,
  applyPinchContactConstraint,
  assignHandTracks,
  estimateHandDepth,
  estimatePalmCenter,
  estimatePinchRatio,
  estimateProjectedHandDepth,
  mapHandPointToNdc,
  mapMediaPipeToXR,
  mapVideoPointToViewportNdc,
  mapVirtualJoystick,
  occlusionOpacity,
  isOpenPalm,
  selectPrimaryHandDetections,
} from '../src/handPoseMath.js';

function point(x, y = 0, z = 0) {
  return { x, y, z };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

test('depth estimation clamps invalid, near, and far observations', () => {
  assert.equal(estimateHandDepth({
    screenPalmWidthPx: 0,
    worldPalmWidth: 0,
    viewportHeight: 900,
    cameraFovDeg: 68,
  }), (HAND_DEPTH_MIN + HAND_DEPTH_MAX) / 2);
  assert.equal(estimateHandDepth({
    screenPalmWidthPx: 1000,
    worldPalmWidth: 0.08,
    viewportHeight: 900,
    cameraFovDeg: 68,
  }), HAND_DEPTH_MIN);
  assert.equal(estimateHandDepth({
    screenPalmWidthPx: 4,
    worldPalmWidth: 0.08,
    viewportHeight: 900,
    cameraFovDeg: 68,
  }), HAND_DEPTH_MAX);
});

test('21-to-25 mapping preserves bind-pose segment lengths', () => {
  const source = Array.from({ length: 21 }, (_, index) => point(index * 0.01, index * 0.02, 0));
  const bind = Array.from({ length: 25 }, (_, index) => point(index * 0.008, index * 0.012, 0));
  const mapped = mapMediaPipeToXR(source, bind);
  assert.equal(mapped.length, 25);
  mapped.forEach((joint) => {
    assert.ok(Number.isFinite(joint.x));
    assert.ok(Number.isFinite(joint.y));
    assert.ok(Number.isFinite(joint.z));
  });
  assert.notDeepEqual(mapped[5], mapped[6]);
  assert.notDeepEqual(mapped[20], mapped[21]);
  const scale = Math.min(1.4, Math.max(0.7, distance(source[5], source[17]) / distance(bind[6], bind[21])));
  assert.ok(Math.abs(distance(mapped[5], mapped[0]) - distance(bind[5], bind[0]) * scale) < 1e-9);
  assert.ok(Math.abs(distance(mapped[6], mapped[5]) - distance(bind[6], bind[5]) * scale) < 1e-9);
});

test('21-to-25 mapping can reuse a caller-owned output buffer', () => {
  const source = Array.from({ length: 21 }, (_, index) => point(index * 0.01, index * 0.02, 0));
  const bind = Array.from({ length: 25 }, (_, index) => point(index * 0.008, index * 0.012, 0));
  const output = Array.from({ length: 25 }, () => point(0));
  const mapped = mapMediaPipeToXR(source, bind, output);
  assert.equal(mapped, output);
  assert.equal(mapped[0], output[0]);
  assert.deepEqual(mapped[0], source[0]);
});

test('pinch contact constraint makes reconstructed fingertips meet without affecting open hands', () => {
  const openHand = Array.from({ length: 25 }, () => point(0));
  openHand[4] = point(-0.04, 0.02, 0);
  openHand[9] = point(0.06, 0.02, 0);
  const unchanged = openHand.map((joint) => ({ ...joint }));
  assert.equal(applyPinchContactConstraint(openHand, 0.7), 0);
  assert.deepEqual(openHand, unchanged);

  const pinchingHand = unchanged.map((joint) => ({ ...joint }));
  const amount = applyPinchContactConstraint(pinchingHand, 0.2);
  assert.equal(amount, 1);
  assert.ok(distance(pinchingHand[4], pinchingHand[9]) < 1e-12);
  assert.ok(Math.abs(pinchingHand[3].x) > Math.abs(pinchingHand[2].x));
  assert.ok(Math.abs(pinchingHand[8].x) > Math.abs(pinchingHand[7].x));
});

test('pinch ratio uses only visible fingertip distance and ignores noisy depth', () => {
  const landmarks = Array.from({ length: 21 }, () => point(0));
  landmarks[0] = point(0, 0, 0);
  landmarks[9] = point(0, 0.2, 0);
  landmarks[5] = point(-0.1, 0.08, 0);
  landmarks[17] = point(0.1, 0.08, 0);
  landmarks[4] = point(0.01, 0.04, 0.1);
  landmarks[8] = point(0.01, 0.04, 0);
  assert.equal(estimatePinchRatio(landmarks), 0);

  landmarks[4] = point(-0.1, 0.04, 0);
  landmarks[8] = point(0.1, 0.04, 0);
  assert.ok(estimatePinchRatio(landmarks) > 0.5);
});

test('a C-shaped hand is not a pinch when its fingertips remain apart', () => {
  const landmarks = Array.from({ length: 21 }, () => point(0));
  landmarks[0] = point(0, 0, 0);
  landmarks[9] = point(0, 0.2, 0);
  landmarks[5] = point(-0.1, 0.08, 0);
  landmarks[17] = point(0.1, 0.08, 0);
  landmarks[7] = point(0, 0, 0);
  landmarks[8] = point(0, 0.2, 0);
  landmarks[3] = point(-0.04, 0.02, 0);
  landmarks[4] = point(0.01, 0.02, 0);
  assert.ok(distance(landmarks[4], landmarks[8]) > 0.15);
  assert.ok(estimatePinchRatio(landmarks) > 0.5);
});

function makeOpenPalm() {
  const landmarks = Array.from({ length: 21 }, () => point(0, 0, 0));
  landmarks[0] = point(0, 0, 0);
  landmarks[5] = point(-0.12, 0.16, 0);
  landmarks[9] = point(-0.04, 0.18, 0);
  landmarks[13] = point(0.04, 0.17, 0);
  landmarks[17] = point(0.12, 0.14, 0);
  [[6, 7, 8, -0.12], [10, 11, 12, -0.04], [14, 15, 16, 0.04], [18, 19, 20, 0.12]]
    .forEach(([pip, dip, tip, x]) => {
      landmarks[pip] = point(x, 0.3, 0);
      landmarks[dip] = point(x, 0.43, 0);
      landmarks[tip] = point(x, 0.58, 0);
    });
  landmarks[3] = point(-0.17, 0.2, 0);
  landmarks[4] = point(-0.27, 0.28, 0);
  return landmarks;
}

test('open-palm detection rejects a fist and a pinch', () => {
  const open = makeOpenPalm();
  assert.equal(isOpenPalm(open), true);
  const fist = open.map((landmark) => ({ ...landmark }));
  [8, 12, 16, 20].forEach((tip, index) => {
    const pip = [6, 10, 14, 18][index];
    fist[tip] = point(fist[pip].x, 0.2, 0);
  });
  assert.equal(isOpenPalm(fist), false);
  const pinch = open.map((landmark) => ({ ...landmark }));
  pinch[4] = point(-0.12, 0.58, 0);
  assert.equal(isOpenPalm(pinch), false);
});

test('palm center averages stable palm landmarks', () => {
  const palm = makeOpenPalm();
  const center = estimatePalmCenter(palm);
  assert.ok(Math.abs(center.x) < 1e-12);
  assert.ok(Math.abs(center.y - 0.13) < 1e-12);
});

test('gesture stabilizer requires the configured open-palm dwell', () => {
  const stabilizer = new GestureStabilizer({ enterDwellMs: 250 });
  assert.equal(stabilizer.update(true, 0), false);
  assert.equal(stabilizer.update(true, 249), false);
  assert.equal(stabilizer.update(true, 250), true);
  assert.equal(stabilizer.update(false, 251), false);
});

test('virtual joystick has a dead zone and reaches full range', () => {
  assert.deepEqual(
    mapVirtualJoystick({ x: 0.03, y: 0.02 }, { x: 0, y: 0 }),
    { strafe: 0, forward: 0, magnitude: Math.hypot(0.03, 0.02), strength: 0, inDeadZone: true },
  );
  const full = mapVirtualJoystick({ x: 0.3, y: 0 }, { x: 0, y: 0 });
  assert.equal(full.strafe, 1);
  assert.equal(full.forward, 0);
  assert.equal(full.strength, 1);
});

test('movement gate stays locked until the palm recenters for 150 ms', () => {
  const gate = new MovementRearmGate({ centerDwellMs: 150 });
  assert.equal(gate.update(false, 0), true);
  gate.beginManipulation();
  assert.equal(gate.update(true, 10), false);
  gate.endManipulation();
  assert.equal(gate.update(false, 20), false);
  assert.equal(gate.update(true, 100), false);
  assert.equal(gate.update(true, 249), false);
  assert.equal(gate.update(true, 250), true);
});

test('projected depth is invariant to palm orientation in scene projection space', () => {
  const cameraAspect = 16 / 9;
  const horizontal = estimateProjectedHandDepth({
    normalizedDeltaX: 0.1,
    normalizedDeltaY: 0,
    worldPalmWidth: 0.08,
    cameraAspect,
    cameraFovDeg: 68,
  });
  const vertical = estimateProjectedHandDepth({
    normalizedDeltaX: 0,
    normalizedDeltaY: 0.1 * cameraAspect,
    worldPalmWidth: 0.08,
    cameraAspect,
    cameraFovDeg: 68,
  });
  assert.ok(Math.abs(horizontal - vertical) < 1e-12);
});

test('full-screen hand mapping reaches every NDC edge with balanced gain', () => {
  assert.deepEqual(mapHandPointToNdc({ x: 0, y: 0 }), { x: 1, y: 1, z: 0 });
  assert.deepEqual(mapHandPointToNdc({ x: 1, y: 1 }), { x: -1, y: -1, z: 0 });
  assert.equal(mapHandPointToNdc({ x: 0.06, y: 0.5 }).x, 1);
  assert.equal(mapHandPointToNdc({ x: 0.94, y: 0.5 }).x, -1);
});

test('camera points use mirrored cover mapping instead of viewport stretching', () => {
  const center = mapVideoPointToViewportNdc(point(0.5, 0.5), {
    videoWidth: 640,
    videoHeight: 480,
    viewportWidth: 1280,
    viewportHeight: 720,
  });
  assert.deepEqual(center, point(0, 0));

  const upperLeft = mapVideoPointToViewportNdc(point(0.25, 0.25), {
    videoWidth: 640,
    videoHeight: 480,
    viewportWidth: 1280,
    viewportHeight: 720,
  });
  assert.equal(upperLeft.x, 0.5, 'mirrored camera X should align with the viewport');
  assert.ok(Math.abs(upperLeft.y - 2 / 3) < 1e-12, 'cover crop should be reflected in Y');
});

test('One Euro filter converges without overshooting a constant input', () => {
  const filter = new OneEuroScalar({ minCutoff: 1.2, beta: 0.25 });
  assert.equal(filter.filter(0, 0), 0);
  let value = 0;
  for (let frame = 1; frame <= 90; frame += 1) value = filter.filter(1, frame * 33.333);
  assert.ok(value > 0.99 && value <= 1);
});

test('three-sample median rejects a single false pinch sample', () => {
  const filter = new MedianFilterScalar(3);
  assert.equal(filter.filter(0.8), 0.8);
  assert.equal(filter.filter(0.1), 0.45);
  assert.equal(filter.filter(0.82), 0.8);
  assert.equal(filter.filter(0.12), 0.12);
});

test('HoloMath Kalman aim filter freezes stationary sub-pixel jitter', () => {
  const filter = new KalmanAimFilter2D();
  const initial = filter.reset(point(0.2, -0.1), 0);
  const next = filter.filter(point(0.2004, -0.1003), 16, 0.9);
  assert.equal(next.x, initial.x);
  assert.equal(next.y, initial.y);
});

test('HoloMath Kalman aim filter predicts forward across inference latency', () => {
  const filter = new KalmanAimFilter2D();
  filter.reset(point(0, 0), 0);
  filter.filter(point(0.08, 0), 33, 0.9);
  const current = filter.filter(point(0.18, 0), 66, 0.9);
  const predicted = filter.predict(99);
  assert.ok(predicted.x >= current.x, 'prediction should continue in the measured direction');
  assert.ok(predicted.x - current.x <= 0.35, 'prediction must stay inside the coast bound');
});

test('dynamic motion gate rejects low-speed sensor jitter', () => {
  const gate = new DynamicMotionGateVector3({
    jitterRadius: 0.003,
    slowSpeed: 0.08,
    fastSpeed: 1,
  });
  gate.reset(point(0), 0);
  const samples = [0.001, -0.0015, 0.002, -0.0005, 0.0012];
  let accepted = point(0);
  samples.forEach((x, index) => {
    accepted = gate.filter(point(x), (index + 1) * 33.333);
  });
  assert.deepEqual(accepted, point(0));
  assert.equal(gate.mode, 'slow');
});

test('dynamic motion gate predicts and widens its corridor during fast motion', () => {
  const gate = new DynamicMotionGateVector3({
    jitterRadius: 0.003,
    slowSpeed: 0.04,
    fastSpeed: 0.5,
    minAllowedStep: 0.004,
    maxAllowedStep: 0.2,
    maxPredictionSeconds: 0.05,
  });
  gate.reset(point(0), 0);
  gate.filter(point(0.03), 33.333);
  const accepted = gate.filter(point(0.09), 66.666);
  assert.equal(gate.mode, 'fast');
  assert.ok(gate.allowedStep > 0.1);
  assert.ok(accepted.x > 0.09, 'fast path should be projected ahead of the latest sample');
});

test('dynamic motion gate clamps discontinuous samples to its allowed corridor', () => {
  const gate = new DynamicMotionGateVector3({
    slowSpeed: 0.1,
    fastSpeed: 2,
    minAllowedStep: 0.002,
    maxAllowedStep: 0.05,
    maxPredictionSeconds: 0,
    maxAcceleration: 0,
  });
  gate.reset(point(0), 0);
  const accepted = gate.filter(point(1), 33.333);
  assert.ok(accepted.x <= gate.allowedStep + 1e-12);
  assert.ok(accepted.x < 0.2);
});

test('pinch state uses filtered entry and immediate raw-distance release', () => {
  const pinch = new PinchStateMachine();
  assert.equal(pinch.update(0.2, 0.8), null, 'stale filtered contact must not start a pinch');
  assert.equal(pinch.update(0.31, 0.31), 'start');
  assert.equal(pinch.update(0.4, 0.4), null);
  assert.equal(pinch.update(0.3, 0.7), 'end');
  assert.equal(pinch.forceEnd(), null);
  assert.equal(pinch.update(0.2, 0.2), 'start');
  assert.equal(pinch.forceEnd(), 'end');
});

test('pinch release grace ignores a transient wide fingertip sample', () => {
  const pinch = new PinchStateMachine({ exitGraceMs: 180 });
  assert.equal(pinch.update(0.2, 0.2, 0), 'start');
  assert.equal(pinch.update(0.35, 0.7, 40), null);
  assert.equal(pinch.pinching, true);
  assert.equal(pinch.update(0.25, 0.25, 80), null);
  assert.equal(pinch.update(0.35, 0.7, 100), null);
  assert.equal(pinch.update(0.35, 0.7, 280), 'end');
});

test('left and right pinch machines classify independently', () => {
  const left = new PinchStateMachine();
  const right = new PinchStateMachine();
  assert.equal(left.update(0.2, 0.2), 'start');
  assert.equal(right.update(0.8, 0.8), null);
  assert.equal(left.pinching, true);
  assert.equal(right.pinching, false);
  assert.equal(right.update(0.2, 0.2), 'start');
  assert.equal(left.pinching, true);
  assert.equal(right.pinching, true);
});

test('track assignment favors wrist continuity when handedness labels flip', () => {
  const tracks = [
    { label: 'Left', lastWrist: point(0.2, 0.5), lastSeenAt: 90 },
    { label: 'Right', lastWrist: point(0.8, 0.5), lastSeenAt: 90 },
  ];
  const detections = [
    { label: 'Right', score: 0.99, wrist: point(0.21, 0.5) },
    { label: 'Left', score: 0.99, wrist: point(0.79, 0.5) },
  ];
  assert.deepEqual(assignHandTracks(tracks, detections, { nowMs: 100 }), [0, 1]);
});

test('a single initial detection is assigned by confident handedness', () => {
  const tracks = [
    { label: 'Left', lastWrist: null, lastSeenAt: -Infinity },
    { label: 'Right', lastWrist: null, lastSeenAt: -Infinity },
  ];
  const detections = [{ label: 'Right', score: 0.95, wrist: point(0.5, 0.5) }];
  assert.deepEqual(assignHandTracks(tracks, detections, { nowMs: 0 }), [-1, 0]);
});

test('active hand remains attached to its nearest wrist through low-confidence relabeling', () => {
  const tracks = [
    { label: 'Left', lastWrist: point(0.35, 0.4), lastSeenAt: 90 },
    { label: 'Right', lastWrist: point(0.7, 0.4), lastSeenAt: 90 },
  ];
  const detections = [
    { label: 'Right', score: 0.2, wrist: point(0.37, 0.41) },
    { label: 'Left', score: 0.2, wrist: point(0.68, 0.41) },
  ];
  assert.deepEqual(assignHandTracks(tracks, detections, {
    activeHand: 'Left',
    nowMs: 100,
  }), [0, 1]);
});

test('recently occluded active hand reacquires the nearest detection', () => {
  const tracks = [
    { label: 'Left', lastWrist: point(0.3, 0.3), lastSeenAt: 0 },
    { label: 'Right', lastWrist: point(0.8, 0.3), lastSeenAt: 0 },
  ];
  const detections = [{ label: 'Right', score: 0.9, wrist: point(0.32, 0.31) }];
  assert.deepEqual(assignHandTracks(tracks, detections, {
    activeHand: 'Left',
    nowMs: 180,
  }), [0, -1]);
});

test('primary hand lock ignores a bystander while both owner hands are continuous', () => {
  const tracks = [
    { label: 'Left', lastWrist: point(0.2, 0.5), lastSeenAt: 100 },
    { label: 'Right', lastWrist: point(0.8, 0.5), lastSeenAt: 100 },
  ];
  const bystander = { label: 'Left', wrist: point(0.5, 0.5) };
  const ownerLeft = { label: 'Left', wrist: point(0.21, 0.5) };
  const ownerRight = { label: 'Right', wrist: point(0.79, 0.5) };
  const selection = selectPrimaryHandDetections(
    [bystander, ownerRight, ownerLeft],
    tracks,
    { nowMs: 150, lastPrimarySeenAt: 100 },
  );
  assert.equal(selection.lockActive, true);
  assert.deepEqual(selection.detections, [ownerLeft, ownerRight]);
});

test('primary hand lock reacquires fast owner movement but still rejects distant bystanders', () => {
  const tracks = [{ label: 'Left', lastWrist: point(0.2, 0.5), lastSeenAt: 100 }];
  const replacement = [
    { label: 'Left', wrist: point(0.7, 0.5) },
    { label: 'Right', wrist: point(0.85, 0.5) },
  ];
  const reacquired = selectPrimaryHandDetections(replacement, tracks, {
    nowMs: 300,
    lastPrimarySeenAt: 100,
  });
  assert.deepEqual(reacquired.detections, replacement);

  const distantBystander = [{ label: 'Left', wrist: point(0.9, 0.5) }];
  const locked = selectPrimaryHandDetections(distantBystander, tracks, {
    nowMs: 300,
    lastPrimarySeenAt: 100,
  });
  assert.deepEqual(locked.detections, []);

  const expired = selectPrimaryHandDetections(replacement, tracks, {
    nowMs: 751,
    lastPrimarySeenAt: 100,
  });
  assert.equal(expired.lockActive, false);
  assert.deepEqual(expired.detections, replacement);
});

test('worker recovery policy restarts on timeout or three consecutive frame errors', () => {
  const policy = new WorkerRecoveryPolicy();
  assert.equal(policy.recordFrameError(), 'none');
  assert.equal(policy.recordFrameError(), 'none');
  assert.equal(policy.recordFrameError(), 'restart');
  assert.equal(policy.recordSuccess(), 'none');
  assert.equal(policy.recordFrameError(), 'none');
  assert.equal(policy.recordSuccess(), 'none');
  assert.equal(policy.recordTimeout(), 'restart');
});

test('hand arbiter keeps a primary hand while allowing dual pinches', () => {
  const arbiter = new HandInteractionArbiter();
  const firstTarget = { id: 'dial' };
  assert.equal(arbiter.claim('Left', firstTarget), true);
  assert.equal(arbiter.claim('Right', { id: 'rail' }), true);
  assert.equal(arbiter.activeHand, 'Left');
  assert.equal(arbiter.target, firstTarget);
  assert.equal(arbiter.release('Left'), true);
  assert.equal(arbiter.activeHand, 'Right');
  assert.equal(arbiter.release('Right'), true);
  assert.equal(arbiter.activeHand, null);
  assert.equal(arbiter.claim('Right', { id: 'rail' }), true);
});

test('occlusion keeps, fades, then hides the hand', () => {
  assert.equal(occlusionOpacity(0), 1);
  assert.equal(occlusionOpacity(OCCLUSION_HOLD_MS), 1);
  assert.equal(occlusionOpacity(OCCLUSION_HOLD_MS + OCCLUSION_FADE_MS / 2), 0.5);
  assert.equal(occlusionOpacity(OCCLUSION_HOLD_MS + OCCLUSION_FADE_MS), 0);
});
