export const HAND_DEPTH_MIN = 0.35;
export const HAND_DEPTH_MAX = 1.2;
// A single webcam inference can miss a hand because of motion blur, exposure,
// or a dropped worker frame. Keep the last valid pose briefly so that a
// momentary miss does not cancel an in-progress AR interaction.
export const OCCLUSION_HOLD_MS = 400;
export const OCCLUSION_FADE_MS = 120;

const TAU = Math.PI * 2;
const EPSILON = 1e-8;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * A deliberately small, observable pinch metric. Camera Z is excluded because
 * a single webcam estimates it poorly; only the two visible fingertips and a
 * stable image-plane palm scale participate in gesture classification.
 */
export function estimatePinchRatio(landmarks) {
  if (landmarks?.length !== 21) return Infinity;
  const distance2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const fingertipDistance = distance2(landmarks[4], landmarks[8]);
  const palmWidth = distance2(landmarks[5], landmarks[17]);
  const wristToMiddle = distance2(landmarks[0], landmarks[9]);
  const palmScale = Math.max(palmWidth, wristToMiddle * 0.75, 0.04);
  return fingertipDistance / palmScale;
}

export function estimatePalmCenter(landmarks, output = null) {
  const result = output || {};
  if (landmarks?.length !== 21) {
    result.x = 0;
    result.y = 0;
    result.z = 0;
    return result;
  }
  const indices = [0, 5, 9, 13, 17];
  result.x = 0;
  result.y = 0;
  result.z = 0;
  indices.forEach((index) => {
    result.x += Number(landmarks[index]?.x || 0);
    result.y += Number(landmarks[index]?.y || 0);
    result.z += Number(landmarks[index]?.z || 0);
  });
  result.x /= indices.length;
  result.y /= indices.length;
  result.z /= indices.length;
  return result;
}

/** Detect a navigation-ready open palm without relying on noisy camera depth. */
export function isOpenPalm(landmarks, {
  extensionRatio = 1.12,
  minPinchRatio = 0.52,
} = {}) {
  if (landmarks?.length !== 21) return false;
  const wrist = landmarks[0];
  const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]];
  const extended = fingers.reduce((count, [tipIndex, pipIndex]) => {
    const tip = landmarks[tipIndex];
    const pip = landmarks[pipIndex];
    const tipDistance = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    const pipDistance = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
    return count + Number(tipDistance > pipDistance * extensionRatio);
  }, 0);
  return extended >= 4 && estimatePinchRatio(landmarks) >= minPinchRatio;
}

export class GestureStabilizer {
  constructor({ enterDwellMs = 250, exitDwellMs = 0 } = {}) {
    this.enterDwellMs = Math.max(0, enterDwellMs);
    this.exitDwellMs = Math.max(0, exitDwellMs);
    this.reset();
  }

  reset() {
    this.stable = false;
    this.candidate = null;
    this.candidateSince = -Infinity;
    return this.stable;
  }

  update(active, nowMs) {
    const next = !!active;
    if (next === this.stable) {
      this.candidate = null;
      return this.stable;
    }
    if (this.candidate !== next) {
      this.candidate = next;
      this.candidateSince = nowMs;
    }
    const dwell = next ? this.enterDwellMs : this.exitDwellMs;
    if (nowMs - this.candidateSince >= dwell) {
      this.stable = next;
      this.candidate = null;
    }
    return this.stable;
  }
}

export function mapVirtualJoystick(current, anchor, {
  deadZone = 0.07,
  maxRadius = 0.3,
} = {}, output = null) {
  const result = output || {};
  const dx = Number(current?.x || 0) - Number(anchor?.x || 0);
  const dy = Number(current?.y || 0) - Number(anchor?.y || 0);
  const magnitude = Math.hypot(dx, dy);
  const inDeadZone = magnitude <= deadZone;
  let strength = 0;
  if (!inDeadZone) {
    const linear = clamp((magnitude - deadZone) / Math.max(maxRadius - deadZone, EPSILON), 0, 1);
    strength = smoothstep01(linear);
  }
  const inverseMagnitude = magnitude > EPSILON ? 1 / magnitude : 0;
  result.strafe = dx * inverseMagnitude * strength;
  result.forward = dy * inverseMagnitude * strength;
  result.magnitude = magnitude;
  result.strength = strength;
  result.inDeadZone = inDeadZone;
  return result;
}

export class MovementRearmGate {
  constructor({ centerDwellMs = 150 } = {}) {
    this.centerDwellMs = Math.max(0, centerDwellMs);
    this.reset();
  }

  reset() {
    this.manipulating = false;
    this.awaitingCenter = false;
    this.centerSince = -Infinity;
  }

  beginManipulation() {
    this.manipulating = true;
    this.awaitingCenter = true;
    this.centerSince = -Infinity;
  }

  endManipulation() {
    this.manipulating = false;
    this.awaitingCenter = true;
    this.centerSince = -Infinity;
  }

  update(inDeadZone, nowMs) {
    if (this.manipulating) return false;
    if (!this.awaitingCenter) return true;
    if (!inDeadZone) {
      this.centerSince = -Infinity;
      return false;
    }
    if (!Number.isFinite(this.centerSince)) this.centerSince = nowMs;
    if (nowMs - this.centerSince >= this.centerDwellMs) {
      this.awaitingCenter = false;
      return true;
    }
    return false;
  }
}

export function estimateHandDepth({
  screenPalmWidthPx,
  worldPalmWidth,
  viewportHeight,
  cameraFovDeg,
  minDepth = HAND_DEPTH_MIN,
  maxDepth = HAND_DEPTH_MAX,
}) {
  if (!(screenPalmWidthPx > 0) || !(worldPalmWidth > 0) || !(viewportHeight > 0)) {
    return (minDepth + maxDepth) * 0.5;
  }
  const focalLengthPx = viewportHeight / (2 * Math.tan((cameraFovDeg * Math.PI) / 360));
  return clamp((worldPalmWidth * focalLengthPx) / screenPalmWidthPx, minDepth, maxDepth);
}

/**
 * Estimate depth in the same projection space used to render the tracked hand.
 * Normalized landmark deltas are scaled with the scene-camera aspect ratio so
 * rotating a palm cannot change its depth merely because the camera and window
 * use different aspect ratios.
 */
export function estimateProjectedHandDepth({
  normalizedDeltaX,
  normalizedDeltaY,
  worldPalmWidth,
  cameraAspect,
  cameraFovDeg,
  minDepth = HAND_DEPTH_MIN,
  maxDepth = HAND_DEPTH_MAX,
}) {
  if (!(worldPalmWidth > 0) || !(cameraAspect > 0)) {
    return (minDepth + maxDepth) * 0.5;
  }
  const projectedSpan = Math.hypot(
    normalizedDeltaX * cameraAspect,
    normalizedDeltaY,
  );
  if (!(projectedSpan > EPSILON)) return (minDepth + maxDepth) * 0.5;
  const halfFovTangent = Math.tan((cameraFovDeg * Math.PI) / 360);
  return clamp(worldPalmWidth / (2 * halfFovTangent * projectedSpan), minDepth, maxDepth);
}

export function mapHandPointToNdc(
  { x, y },
  { gainX = 1.15, gainY = 1.1 } = {},
  output = null,
) {
  const result = output || {};
  result.x = clamp((1 - x * 2) * gainX, -1, 1);
  result.y = clamp((1 - y * 2) * gainY, -1, 1);
  result.z = 0;
  return result;
}

/**
 * Map an unmirrored MediaPipe camera point into the viewport exactly like a
 * mirrored `object-fit: cover` video. This keeps the virtual hand projected
 * over the user's real hand even when camera and viewport aspect ratios differ.
 */
export function mapVideoPointToViewportNdc(
  { x, y },
  {
    videoWidth = 1280,
    videoHeight = 720,
    viewportWidth = 1280,
    viewportHeight = 720,
    mirrorX = true,
  } = {},
  output = null,
) {
  const result = output || {};
  const safeVideoWidth = Math.max(Number(videoWidth) || 0, 1);
  const safeVideoHeight = Math.max(Number(videoHeight) || 0, 1);
  const safeViewportWidth = Math.max(Number(viewportWidth) || 0, 1);
  const safeViewportHeight = Math.max(Number(viewportHeight) || 0, 1);
  const videoAspect = safeVideoWidth / safeVideoHeight;
  const viewportAspect = safeViewportWidth / safeViewportHeight;
  let renderWidth = safeViewportWidth;
  let renderHeight = safeViewportHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (videoAspect > viewportAspect) {
    renderWidth = safeViewportHeight * videoAspect;
    offsetX = (renderWidth - safeViewportWidth) * 0.5;
  } else if (videoAspect < viewportAspect) {
    renderHeight = safeViewportWidth / videoAspect;
    offsetY = (renderHeight - safeViewportHeight) * 0.5;
  }

  const cameraX = mirrorX ? 1 - x : x;
  const pixelX = cameraX * renderWidth - offsetX;
  const pixelY = y * renderHeight - offsetY;
  result.x = clamp((pixelX / safeViewportWidth) * 2 - 1, -1, 1);
  result.y = clamp(1 - (pixelY / safeViewportHeight) * 2, -1, 1);
  result.z = 0;
  return result;
}

/**
 * Convert MediaPipe's 21 points to the WebXR 25-joint layout. Segment lengths
 * come from the GLB bind pose, so noisy detections cannot stretch the mesh.
 */
export function mapMediaPipeToXR(source, bindPose, output = null) {
  if (source?.length !== 21 || bindPose?.length !== 25) {
    throw new Error('Expected 21 MediaPipe points and 25 WebXR bind joints');
  }

  const target = output?.length === 25
    ? output
    : Array.from({ length: 25 }, () => ({ x: 0, y: 0, z: 0 }));
  for (let index = 0; index < 25; index += 1) {
    if (!target[index]) target[index] = { x: 0, y: 0, z: 0 };
  }
  target[0].x = source[0].x;
  target[0].y = source[0].y;
  target[0].z = source[0].z;

  const bindPalmWidth = Math.max(distance3(bindPose[6], bindPose[21]), EPSILON);
  const sourcePalmWidth = Math.max(distance3(source[5], source[17]), EPSILON);
  const handScale = clamp(sourcePalmWidth / bindPalmWidth, 0.7, 1.4);

  const placeSegment = (targetIndex, previousTargetIndex, sourceFrom, sourceTo) => {
    const bindLength = distance3(bindPose[targetIndex], bindPose[previousTargetIndex]) * handScale;
    let directionX = source[sourceTo].x - source[sourceFrom].x;
    let directionY = source[sourceTo].y - source[sourceFrom].y;
    let directionZ = source[sourceTo].z - source[sourceFrom].z;
    const directionLength = Math.hypot(directionX, directionY, directionZ);
    if (directionLength < EPSILON) {
      directionX = 0;
      directionY = 1;
      directionZ = 0;
    } else {
      directionX /= directionLength;
      directionY /= directionLength;
      directionZ /= directionLength;
    }
    const previous = target[previousTargetIndex];
    const point = target[targetIndex];
    point.x = previous.x + directionX * bindLength;
    point.y = previous.y + directionY * bindLength;
    point.z = previous.z + directionZ * bindLength;
  };

  // Thumb landmarks already match the WebXR joint count.
  for (let index = 1; index <= 4; index += 1) {
    placeSegment(index, index - 1, index - 1, index);
  }

  const fingers = [
    { rigStart: 5, mpStart: 5 },
    { rigStart: 10, mpStart: 9 },
    { rigStart: 15, mpStart: 13 },
    { rigStart: 20, mpStart: 17 },
  ];

  fingers.forEach(({ rigStart, mpStart }) => {
    // MediaPipe omits the metacarpal joint. Split wrist-to-MCP using the two
    // corresponding bind-pose lengths instead of a universal interpolation.
    placeSegment(rigStart, 0, 0, mpStart);
    placeSegment(rigStart + 1, rigStart, 0, mpStart);
    placeSegment(rigStart + 2, rigStart + 1, mpStart, mpStart + 1);
    placeSegment(rigStart + 3, rigStart + 2, mpStart + 1, mpStart + 2);
    placeSegment(rigStart + 4, rigStart + 3, mpStart + 2, mpStart + 3);
  });

  return target;
}

/**
 * Reconcile the independently reconstructed thumb/index chains while the
 * source landmarks report a pinch. The correction is distributed over the
 * last joints so the fingertips meet without an abrupt distal-bone kink.
 */
export function applyPinchContactConstraint(
  joints,
  pinchRatio,
  {
    contactStart = 0.5,
    fullContact = 0.2,
    distalInfluence = 0.35,
    intermediateInfluence = 0.12,
  } = {},
) {
  if (joints?.length !== 25 || !Number.isFinite(pinchRatio)) return 0;
  const contactAmount = smoothstep01(
    (contactStart - pinchRatio) / Math.max(contactStart - fullContact, EPSILON),
  );
  if (contactAmount <= 0) return 0;

  const thumbTip = joints[4];
  const indexTip = joints[9];
  const contactX = (thumbTip.x + indexTip.x) * 0.5;
  const contactY = (thumbTip.y + indexTip.y) * 0.5;
  const contactZ = (thumbTip.z + indexTip.z) * 0.5;
  const thumbDeltaX = (contactX - thumbTip.x) * contactAmount;
  const thumbDeltaY = (contactY - thumbTip.y) * contactAmount;
  const thumbDeltaZ = (contactZ - thumbTip.z) * contactAmount;
  const indexDeltaX = (contactX - indexTip.x) * contactAmount;
  const indexDeltaY = (contactY - indexTip.y) * contactAmount;
  const indexDeltaZ = (contactZ - indexTip.z) * contactAmount;

  joints[2].x += thumbDeltaX * intermediateInfluence;
  joints[2].y += thumbDeltaY * intermediateInfluence;
  joints[2].z += thumbDeltaZ * intermediateInfluence;
  joints[3].x += thumbDeltaX * distalInfluence;
  joints[3].y += thumbDeltaY * distalInfluence;
  joints[3].z += thumbDeltaZ * distalInfluence;
  thumbTip.x += thumbDeltaX;
  thumbTip.y += thumbDeltaY;
  thumbTip.z += thumbDeltaZ;

  joints[7].x += indexDeltaX * intermediateInfluence;
  joints[7].y += indexDeltaY * intermediateInfluence;
  joints[7].z += indexDeltaZ * intermediateInfluence;
  joints[8].x += indexDeltaX * distalInfluence;
  joints[8].y += indexDeltaY * distalInfluence;
  joints[8].z += indexDeltaZ * distalInfluence;
  indexTip.x += indexDeltaX;
  indexTip.y += indexDeltaY;
  indexTip.z += indexDeltaZ;
  return contactAmount;
}

function smoothingAlpha(cutoff, dt) {
  const tau = 1 / (TAU * Math.max(cutoff, EPSILON));
  return 1 / (1 + tau / Math.max(dt, EPSILON));
}

export class OneEuroScalar {
  constructor({ minCutoff = 1.2, beta = 0.25, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset(value, timestampMs) {
    this.raw = value;
    this.filtered = value;
    this.derivative = 0;
    this.timestampMs = timestampMs;
    this.initialized = Number.isFinite(value) && Number.isFinite(timestampMs);
    return value;
  }

  filter(value, timestampMs) {
    if (!this.initialized || !Number.isFinite(this.timestampMs) || timestampMs <= this.timestampMs) {
      return this.reset(value, timestampMs);
    }

    const dt = (timestampMs - this.timestampMs) / 1000;
    const rawDerivative = (value - this.raw) / dt;
    const derivativeAlpha = smoothingAlpha(this.dCutoff, dt);
    this.derivative += derivativeAlpha * (rawDerivative - this.derivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    const valueAlpha = smoothingAlpha(cutoff, dt);
    this.filtered += valueAlpha * (value - this.filtered);
    this.raw = value;
    this.timestampMs = timestampMs;
    return this.filtered;
  }
}

export class MedianFilterScalar {
  constructor(size = 3) {
    this.size = Math.max(1, Math.floor(size));
    this.samples = [];
  }

  reset(value) {
    this.samples.length = 0;
    if (Number.isFinite(value)) this.samples.push(value);
    return value;
  }

  filter(value) {
    if (!Number.isFinite(value)) return this.value();
    this.samples.push(value);
    if (this.samples.length > this.size) this.samples.shift();
    return this.value();
  }

  value() {
    if (!this.samples.length) return Infinity;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) * 0.5;
  }
}

export class OneEuroVector3 {
  constructor(options) {
    this.x = new OneEuroScalar(options);
    this.y = new OneEuroScalar(options);
    this.z = new OneEuroScalar(options);
  }

  reset(value, timestampMs, output = null) {
    const result = output || {};
    result.x = this.x.reset(value.x, timestampMs);
    result.y = this.y.reset(value.y, timestampMs);
    result.z = this.z.reset(value.z, timestampMs);
    return result;
  }

  filter(value, timestampMs, output = null) {
    const result = output || {};
    result.x = this.x.filter(value.x, timestampMs);
    result.y = this.y.filter(value.y, timestampMs);
    result.z = this.z.filter(value.z, timestampMs);
    return result;
  }
}

function createKalmanAxis(value = 0) {
  return {
    value,
    velocity: 0,
    acceleration: 0,
    pPosition: 0.1,
    pPositionVelocity: 0,
    pPositionAcceleration: 0,
    pVelocity: 1,
    pVelocityAcceleration: 0,
    pAcceleration: 5,
  };
}

function updateKalmanAxis(axis, measurement, dt, processNoise, measurementNoise) {
  const predictedValue = axis.value
    + axis.velocity * dt
    + 0.5 * axis.acceleration * dt * dt;
  const predictedVelocity = axis.velocity + axis.acceleration * dt;
  const predictedAcceleration = axis.acceleration;
  const t2 = dt * dt;
  const t3 = t2 * dt;
  const t4 = t3 * dt;
  const t5 = t4 * dt;

  const pPosition = axis.pPosition
    + 2 * dt * axis.pPositionVelocity
    + t2 * axis.pPositionAcceleration
    + t2 * axis.pVelocity
    + t3 * axis.pVelocityAcceleration
    + 0.25 * t4 * axis.pAcceleration
    + (t5 / 20) * processNoise;
  const pPositionVelocity = axis.pPositionVelocity
    + dt * (axis.pVelocity + axis.pPositionAcceleration)
    + 1.5 * t2 * axis.pVelocityAcceleration
    + 0.5 * t3 * axis.pAcceleration
    + (t4 / 8) * processNoise;
  const pPositionAcceleration = axis.pPositionAcceleration
    + dt * axis.pVelocityAcceleration
    + 0.5 * t2 * axis.pAcceleration
    + (t3 / 6) * processNoise;
  const pVelocity = axis.pVelocity
    + 2 * dt * axis.pVelocityAcceleration
    + t2 * axis.pAcceleration
    + (t3 / 3) * processNoise;
  const pVelocityAcceleration = axis.pVelocityAcceleration
    + dt * axis.pAcceleration
    + (t2 / 2) * processNoise;
  const pAcceleration = axis.pAcceleration + dt * processNoise;

  const residual = measurement - predictedValue;
  const residualCovariance = pPosition + measurementNoise;
  const positionGain = pPosition / residualCovariance;
  const velocityGain = pPositionVelocity / residualCovariance;
  const accelerationGain = pPositionAcceleration / residualCovariance;

  axis.value = predictedValue + positionGain * residual;
  axis.velocity = predictedVelocity + velocityGain * residual;
  axis.acceleration = predictedAcceleration + accelerationGain * residual;
  axis.pPosition = (1 - positionGain) * pPosition;
  axis.pPositionVelocity = (1 - positionGain) * pPositionVelocity;
  axis.pPositionAcceleration = (1 - positionGain) * pPositionAcceleration;
  axis.pVelocity = pVelocity - velocityGain * pPositionVelocity;
  axis.pVelocityAcceleration = pVelocityAcceleration - velocityGain * pPositionAcceleration;
  axis.pAcceleration = pAcceleration - accelerationGain * pPositionAcceleration;
}

/**
 * Constant-acceleration Kalman cursor used by HoloMath, adapted to the
 * physics lab's NDC aim point. It predicts through camera/inference delay,
 * freezes sub-pixel stationary jitter, and coasts briefly across missed frames.
 */
export class KalmanAimFilter2D {
  constructor({
    stationarySpeed = 0.12,
    deadZone = 0.0018,
    maxVelocity = 6,
    processNoise = 5,
    measurementNoise = 0.001,
    coastDurationMs = 250,
    maxCoastExtrapolation = 0.35,
  } = {}) {
    this.stationarySpeed = stationarySpeed;
    this.deadZone = deadZone;
    this.maxVelocity = maxVelocity;
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
    this.coastDurationMs = coastDurationMs;
    this.maxCoastExtrapolation = maxCoastExtrapolation;
    this.reset();
  }

  reset(value = { x: 0, y: 0 }, timestampMs, output = null) {
    this.x = createKalmanAxis(Number(value?.x) || 0);
    this.y = createKalmanAxis(Number(value?.y) || 0);
    this.accepted = this.accepted || { x: 0, y: 0, z: 0 };
    this.accepted.x = this.x.value;
    this.accepted.y = this.y.value;
    this.accepted.z = 0;
    this.timestampMs = timestampMs;
    this.initialized = Number.isFinite(value?.x)
      && Number.isFinite(value?.y)
      && Number.isFinite(timestampMs);
    return copyVector(this.accepted, output);
  }

  filter(value, timestampMs, confidence = 1, output = null) {
    if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
      return copyVector(this.accepted, output);
    }
    if (!this.initialized || !Number.isFinite(this.timestampMs) || timestampMs <= this.timestampMs) {
      return this.reset(value, timestampMs, output);
    }

    const dt = clamp((timestampMs - this.timestampMs) / 1000, 1 / 240, 0.12);
    const speedBeforeUpdate = Math.hypot(this.x.velocity, this.y.velocity);
    const lowSpeedFactor = speedBeforeUpdate < 0.15
      ? (0.15 - speedBeforeUpdate) / 0.15
      : 0;
    const noiseScale = speedBeforeUpdate < 0.15
      ? 1 + lowSpeedFactor * 4
      : Math.max(0.5, 1 - (speedBeforeUpdate - 0.15) * 0.3);
    const safeConfidence = clamp(Number(confidence) || 0.5, 0.1, 1);
    const measurementNoise = (this.measurementNoise / safeConfidence) * noiseScale;
    const processNoise = this.processNoise * (1 + speedBeforeUpdate * 4);

    updateKalmanAxis(this.x, value.x, dt, processNoise, measurementNoise);
    updateKalmanAxis(this.y, value.y, dt, processNoise, measurementNoise);
    this.x.velocity = clamp(this.x.velocity, -this.maxVelocity, this.maxVelocity);
    this.y.velocity = clamp(this.y.velocity, -this.maxVelocity, this.maxVelocity);

    const estimatedSpeed = Math.hypot(this.x.velocity, this.y.velocity);
    const estimatedDistance = Math.hypot(
      this.x.value - this.accepted.x,
      this.y.value - this.accepted.y,
    );
    if (estimatedSpeed < this.stationarySpeed && estimatedDistance < this.deadZone) {
      this.x.velocity = 0;
      this.y.velocity = 0;
      this.x.acceleration = 0;
      this.y.acceleration = 0;
    } else {
      this.accepted.x = this.x.value;
      this.accepted.y = this.y.value;
    }
    this.timestampMs = timestampMs;
    return copyVector(this.accepted, output);
  }

  predict(timestampMs, output = null) {
    if (!this.initialized || !Number.isFinite(timestampMs) || timestampMs <= this.timestampMs) {
      return copyVector(this.accepted, output);
    }
    const dt = Math.min((timestampMs - this.timestampMs) / 1000, this.coastDurationMs / 1000);
    const predictedX = this.accepted.x
      + this.x.velocity * dt
      + 0.5 * this.x.acceleration * dt * dt;
    const predictedY = this.accepted.y
      + this.y.velocity * dt
      + 0.5 * this.y.acceleration * dt * dt;
    const dx = predictedX - this.accepted.x;
    const dy = predictedY - this.accepted.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > this.maxCoastExtrapolation
      ? this.maxCoastExtrapolation / distance
      : 1;
    const result = output || {};
    result.x = this.accepted.x + dx * scale;
    result.y = this.accepted.y + dy * scale;
    result.z = 0;
    return result;
  }
}

function smoothstep01(value) {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function vectorLength(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function copyVector(value, output = null) {
  const result = output || {};
  result.x = value.x;
  result.y = value.y;
  result.z = value.z;
  return result;
}

/**
 * Motion-aware acceptance corridor for tracked points.
 *
 * At rest, samples inside `jitterRadius` are held at the last accepted point.
 * As coherent velocity rises, the corridor expands from `minAllowedStep` to
 * `maxAllowedStep`. Acceleration contributes only after motion is established,
 * so alternating sensor noise cannot accidentally engage prediction. During
 * fast motion the accepted point is projected forward by velocity and bounded
 * acceleration to compensate for camera/inference latency.
 */
export class DynamicMotionGateVector3 {
  constructor({
    jitterRadius = 0.0015,
    slowSpeed = 0.025,
    fastSpeed = 0.75,
    minAllowedStep = 0.003,
    maxAllowedStep = 0.14,
    maxPredictionSeconds = 0.045,
    accelerationLookaheadSeconds = 0.035,
    maxAcceleration = 12,
    velocityResponse = 12,
    accelerationResponse = 8,
  } = {}) {
    this.jitterRadius = jitterRadius;
    this.slowSpeed = slowSpeed;
    this.fastSpeed = Math.max(fastSpeed, slowSpeed + EPSILON);
    this.minAllowedStep = minAllowedStep;
    this.maxAllowedStep = Math.max(maxAllowedStep, minAllowedStep);
    this.maxPredictionSeconds = maxPredictionSeconds;
    this.accelerationLookaheadSeconds = accelerationLookaheadSeconds;
    this.maxAcceleration = maxAcceleration;
    this.velocityResponse = velocityResponse;
    this.accelerationResponse = accelerationResponse;
    this.reset();
  }

  reset(value = { x: 0, y: 0, z: 0 }, timestampMs, output = null) {
    this.raw = copyVector(value, this.raw);
    this.accepted = copyVector(value, this.accepted);
    this.velocity = this.velocity || { x: 0, y: 0, z: 0 };
    this.acceleration = this.acceleration || { x: 0, y: 0, z: 0 };
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.acceleration.x = 0;
    this.acceleration.y = 0;
    this.acceleration.z = 0;
    this.timestampMs = timestampMs;
    this.speed = 0;
    this.accelerationMagnitude = 0;
    this.motionAmount = 0;
    this.allowedStep = this.minAllowedStep;
    this.mode = 'slow';
    this.initialized = Number.isFinite(value?.x)
      && Number.isFinite(value?.y)
      && Number.isFinite(value?.z)
      && Number.isFinite(timestampMs);
    return copyVector(this.accepted, output);
  }

  filter(value, timestampMs, output = null) {
    const validValue = Number.isFinite(value?.x)
      && Number.isFinite(value?.y)
      && Number.isFinite(value?.z);
    if (!validValue) return copyVector(this.accepted, output);
    if (!this.initialized || !Number.isFinite(this.timestampMs) || timestampMs <= this.timestampMs) {
      return this.reset(value, timestampMs, output);
    }

    const dt = clamp((timestampMs - this.timestampMs) / 1000, 1 / 240, 0.12);
    const rawVelocityX = (value.x - this.raw.x) / dt;
    const rawVelocityY = (value.y - this.raw.y) / dt;
    const rawVelocityZ = (value.z - this.raw.z) / dt;
    const velocityAlpha = 1 - Math.exp(-this.velocityResponse * dt);
    const previousVelocityX = this.velocity.x;
    const previousVelocityY = this.velocity.y;
    const previousVelocityZ = this.velocity.z;
    this.velocity.x += (rawVelocityX - this.velocity.x) * velocityAlpha;
    this.velocity.y += (rawVelocityY - this.velocity.y) * velocityAlpha;
    this.velocity.z += (rawVelocityZ - this.velocity.z) * velocityAlpha;

    const rawAccelerationX = (this.velocity.x - previousVelocityX) / dt;
    const rawAccelerationY = (this.velocity.y - previousVelocityY) / dt;
    const rawAccelerationZ = (this.velocity.z - previousVelocityZ) / dt;
    const accelerationAlpha = 1 - Math.exp(-this.accelerationResponse * dt);
    this.acceleration.x += (rawAccelerationX - this.acceleration.x) * accelerationAlpha;
    this.acceleration.y += (rawAccelerationY - this.acceleration.y) * accelerationAlpha;
    this.acceleration.z += (rawAccelerationZ - this.acceleration.z) * accelerationAlpha;

    this.speed = vectorLength(this.velocity);
    this.accelerationMagnitude = vectorLength(this.acceleration);
    const speedActivation = smoothstep01(
      (this.speed - this.slowSpeed * 0.5) / Math.max(this.slowSpeed * 1.5, EPSILON),
    );
    const accelerationBoost = Math.min(this.accelerationMagnitude, this.maxAcceleration)
      * this.accelerationLookaheadSeconds
      * speedActivation;
    const motionMetric = this.speed + accelerationBoost;
    this.motionAmount = smoothstep01(
      (motionMetric - this.slowSpeed) / (this.fastSpeed - this.slowSpeed),
    );
    this.mode = this.motionAmount < 0.25
      ? 'slow'
      : this.motionAmount > 0.72 ? 'fast' : 'transition';

    const deadZone = this.jitterRadius * (1 - this.motionAmount) ** 2;
    const measuredDeltaX = value.x - this.accepted.x;
    const measuredDeltaY = value.y - this.accepted.y;
    const measuredDeltaZ = value.z - this.accepted.z;
    const measuredDistance = Math.hypot(measuredDeltaX, measuredDeltaY, measuredDeltaZ);

    const boundedAccelerationScale = this.accelerationMagnitude > this.maxAcceleration
      ? this.maxAcceleration / this.accelerationMagnitude
      : 1;
    const predictionSeconds = this.maxPredictionSeconds * this.motionAmount;
    let predictedX = this.accepted.x;
    let predictedY = this.accepted.y;
    let predictedZ = this.accepted.z;
    if (measuredDistance > deadZone) {
      const accelerationTerm = 0.5 * boundedAccelerationScale * predictionSeconds ** 2;
      predictedX = value.x + this.velocity.x * predictionSeconds
        + this.acceleration.x * accelerationTerm;
      predictedY = value.y + this.velocity.y * predictionSeconds
        + this.acceleration.y * accelerationTerm;
      predictedZ = value.z + this.velocity.z * predictionSeconds
        + this.acceleration.z * accelerationTerm;
    }

    const baseAllowedStep = this.minAllowedStep
      + (this.maxAllowedStep - this.minAllowedStep) * this.motionAmount;
    this.allowedStep = Math.min(
      this.maxAllowedStep,
      baseAllowedStep
        + this.speed * dt
        + 0.5 * Math.min(this.accelerationMagnitude, this.maxAcceleration) * dt ** 2,
    );
    const acceptedDeltaX = predictedX - this.accepted.x;
    const acceptedDeltaY = predictedY - this.accepted.y;
    const acceptedDeltaZ = predictedZ - this.accepted.z;
    const acceptedDistance = Math.hypot(acceptedDeltaX, acceptedDeltaY, acceptedDeltaZ);
    const acceptedScale = acceptedDistance > this.allowedStep
      ? this.allowedStep / acceptedDistance
      : 1;
    this.accepted.x += acceptedDeltaX * acceptedScale;
    this.accepted.y += acceptedDeltaY * acceptedScale;
    this.accepted.z += acceptedDeltaZ * acceptedScale;
    copyVector(value, this.raw);
    this.timestampMs = timestampMs;
    return copyVector(this.accepted, output);
  }
}

export class PinchStateMachine {
  constructor({
    enterThreshold = 0.32,
    exitThreshold = 0.5,
    exitGraceMs = 0,
  } = {}) {
    this.enterThreshold = enterThreshold;
    this.exitThreshold = Math.max(exitThreshold, enterThreshold);
    this.exitGraceMs = Math.max(0, Number(exitGraceMs) || 0);
    this.reset();
  }

  reset() {
    this.pinching = false;
    this.releaseSince = null;
  }

  update(filteredRatio, rawRatio = filteredRatio, nowMs = performance.now()) {
    if (!Number.isFinite(filteredRatio) || !Number.isFinite(rawRatio)) return null;
    if (!this.pinching) {
      if (filteredRatio < this.enterThreshold && rawRatio < this.exitThreshold) {
        this.pinching = true;
        this.releaseSince = null;
        return 'start';
      }
      return null;
    }

    if (rawRatio > this.exitThreshold) {
      if (this.exitGraceMs > 0) {
        if (this.releaseSince == null) {
          this.releaseSince = nowMs;
          return null;
        }
        if (nowMs - this.releaseSince < this.exitGraceMs) return null;
      }
      this.pinching = false;
      this.releaseSince = null;
      return 'end';
    }
    this.releaseSince = null;
    return null;
  }

  forceEnd() {
    const wasPinching = this.pinching;
    this.reset();
    return wasPinching ? 'end' : null;
  }
}

function trackDetectionCost(track, detection, nowMs) {
  const score = clamp(Number(detection.score) || 0, 0, 1);
  const labelMismatch = detection.label && detection.label !== track.label;
  const recentlySeen = Number.isFinite(track.lastSeenAt) && nowMs - track.lastSeenAt <= 300;
  const continuity = recentlySeen && track.lastWrist
    ? Math.hypot(
      detection.wrist.x - track.lastWrist.x,
      detection.wrist.y - track.lastWrist.y,
    )
    : 0.35;
  return continuity + (labelMismatch ? 0.4 * score : -0.08 * score);
}

/** Assign at most two detections to persistent left/right interaction tracks. */
export function assignHandTracks(tracks, detections, { activeHand = null, nowMs = 0 } = {}) {
  const assignment = Array(tracks.length).fill(-1);
  const used = new Set();
  const activeTrackIndex = tracks.findIndex((track) => track.label === activeHand);

  if (activeTrackIndex >= 0 && detections.length) {
    const track = tracks[activeTrackIndex];
    if (track.lastWrist && Number.isFinite(track.lastSeenAt) && nowMs - track.lastSeenAt <= 300) {
      let nearestIndex = -1;
      let nearestDistance = Infinity;
      detections.forEach((detection, index) => {
        const distance = Math.hypot(
          detection.wrist.x - track.lastWrist.x,
          detection.wrist.y - track.lastWrist.y,
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      if (nearestDistance <= 0.32) {
        assignment[activeTrackIndex] = nearestIndex;
        used.add(nearestIndex);
      }
    }
  }

  const remainingTracks = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ index }) => assignment[index] < 0);
  const remainingDetections = detections
    .map((detection, index) => ({ detection, index }))
    .filter(({ index }) => !used.has(index));

  if (remainingTracks.length === 2 && remainingDetections.length === 2) {
    const direct = trackDetectionCost(
      remainingTracks[0].track,
      remainingDetections[0].detection,
      nowMs,
    ) + trackDetectionCost(
      remainingTracks[1].track,
      remainingDetections[1].detection,
      nowMs,
    );
    const crossed = trackDetectionCost(
      remainingTracks[0].track,
      remainingDetections[1].detection,
      nowMs,
    ) + trackDetectionCost(
      remainingTracks[1].track,
      remainingDetections[0].detection,
      nowMs,
    );
    const order = direct <= crossed ? [0, 1] : [1, 0];
    remainingTracks.forEach(({ index }, position) => {
      assignment[index] = remainingDetections[order[position]].index;
    });
  } else if (remainingDetections.length === 1) {
    const [{ detection, index: detectionIndex }] = remainingDetections;
    let bestTrackIndex = -1;
    let bestCost = Infinity;
    remainingTracks.forEach(({ track, index }) => {
      const cost = trackDetectionCost(track, detection, nowMs);
      if (cost < bestCost) {
        bestCost = cost;
        bestTrackIndex = index;
      }
    });
    if (bestTrackIndex >= 0) assignment[bestTrackIndex] = detectionIndex;
  } else if (remainingTracks.length === 1) {
    const [{ track, index: trackIndex }] = remainingTracks;
    let bestDetectionIndex = -1;
    let bestCost = Infinity;
    remainingDetections.forEach(({ detection, index }) => {
      const cost = trackDetectionCost(track, detection, nowMs);
      if (cost < bestCost) {
        bestCost = cost;
        bestDetectionIndex = index;
      }
    });
    if (bestDetectionIndex >= 0) assignment[trackIndex] = bestDetectionIndex;
  } else {
    remainingTracks.forEach(({ track, index }) => {
      let bestPosition = -1;
      let bestCost = Infinity;
      remainingDetections.forEach(({ detection, index: detectionIndex }, position) => {
        if (used.has(detectionIndex)) return;
        const cost = trackDetectionCost(track, detection, nowMs);
        if (cost < bestCost) {
          bestCost = cost;
          bestPosition = position;
        }
      });
      if (bestPosition >= 0) {
        const detectionIndex = remainingDetections[bestPosition].index;
        assignment[index] = detectionIndex;
        used.add(detectionIndex);
      }
    });
  }
  return assignment;
}

/**
 * Keep camera interaction attached to the first active user's hands instead
 * of letting a bystander's hand replace a temporarily occluded hand. This is
 * deliberately a continuity lock, not biometric/person identification.
 */
export function selectPrimaryHandDetections(
  detections,
  tracks,
  {
    nowMs = 0,
    lastPrimarySeenAt = -Infinity,
    lockTimeoutMs = 650,
    continuityMs = 500,
    maxContinuityDistance = 0.55,
  } = {},
) {
  const candidates = Array.isArray(detections) ? detections : [];
  const lockActive = Number.isFinite(lastPrimarySeenAt)
    && nowMs - lastPrimarySeenAt < lockTimeoutMs;

  // No owner yet (or the previous owner has been gone long enough): the next
  // visible pair establishes the new primary user.
  if (!lockActive) return { detections: candidates.slice(0, 2), lockActive: false };

  const selected = [];
  const used = new Set();
  const recentTracks = (tracks || []).filter((track) => (
    track?.lastWrist
    && Number.isFinite(track.lastSeenAt)
    && nowMs - track.lastSeenAt <= continuityMs
  ));

  // First reclaim each visible primary hand by wrist continuity. A hand that
  // does not connect to a recent primary track cannot steal control.
  recentTracks.forEach((track) => {
    let bestIndex = -1;
    let bestDistance = Infinity;
    candidates.forEach((detection, index) => {
      if (used.has(index)) return;
      const distance = Math.hypot(
        detection.wrist.x - track.lastWrist.x,
        detection.wrist.y - track.lastWrist.y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestDistance <= maxContinuityDistance) {
      selected.push(candidates[bestIndex]);
      used.add(bestIndex);
    }
  });

  // Permit the locked user's other hand to enter after one hand has already
  // been reclaimed. This preserves normal one-hand-to-two-hand interaction,
  // while a frame containing only unrelated hands remains ignored.
  if (selected.length > 0 && selected.length < 2) {
    const occupiedLabels = new Set(selected.map((detection) => detection.label));
    const preferred = candidates.findIndex((detection, index) => (
      !used.has(index) && detection.label && !occupiedLabels.has(detection.label)
    ));
    const fallback = candidates.findIndex((_, index) => !used.has(index));
    const nextIndex = preferred >= 0 ? preferred : fallback;
    if (nextIndex >= 0) selected.push(candidates[nextIndex]);
  }

  return { detections: selected, lockActive: true };
}

export class WorkerRecoveryPolicy {
  constructor({ frameErrorLimit = 3 } = {}) {
    this.frameErrorLimit = frameErrorLimit;
    this.reset();
  }

  reset() {
    this.consecutiveFrameErrors = 0;
  }

  recordSuccess() {
    this.consecutiveFrameErrors = 0;
    return 'none';
  }

  recordFrameError() {
    this.consecutiveFrameErrors += 1;
    return this.consecutiveFrameErrors >= this.frameErrorLimit ? 'restart' : 'none';
  }

  recordTimeout() {
    this.consecutiveFrameErrors = 0;
    return 'restart';
  }
}

export class HandInteractionArbiter {
  constructor() {
    this.activeHand = null;
    this.target = null;
    this.hands = new Set();
  }

  claim(hand, target = null) {
    if (!hand) return false;
    this.hands.add(hand);
    // Prefer the first owner; allow additional hands for dual-pinch navigation.
    if (!this.activeHand) {
      this.activeHand = hand;
      this.target = target;
    } else if (this.activeHand === hand) {
      this.target = target;
    }
    return true;
  }

  release(hand) {
    if (!hand || !this.hands.has(hand)) return false;
    this.hands.delete(hand);
    if (this.activeHand === hand) {
      const next = this.hands.values().next();
      this.activeHand = next.done ? null : next.value;
      this.target = null;
    }
    return true;
  }

  reset() {
    this.activeHand = null;
    this.target = null;
    this.hands.clear();
  }
}

export function occlusionOpacity(elapsedMs) {
  if (elapsedMs <= OCCLUSION_HOLD_MS) return 1;
  if (elapsedMs >= OCCLUSION_HOLD_MS + OCCLUSION_FADE_MS) return 0;
  return 1 - (elapsedMs - OCCLUSION_HOLD_MS) / OCCLUSION_FADE_MS;
}
