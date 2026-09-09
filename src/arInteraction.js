import { OneEuroScalar } from './handPoseMath.js';

const PHASE_LABELS = {
  idle: '准备',
  navigating: '前进/后退',
  looking: '观察',
  manipulating: '操作',
  'tracking-lost': '追踪丢失',
};
const DEFAULT_TRACKING_LOSS_GRACE_MS = 400;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function viewportSize() {
  // Prefer the lab canvas layout box so look deltas match on-screen pixels
  // when the page is windowed / iframe-embedded (not only after F11).
  const el = typeof document !== 'undefined' ? document.getElementById('c') : null;
  const width = el?.clientWidth > 1
    ? el.clientWidth
    : (Number(globalThis.innerWidth) || 1280);
  const height = el?.clientHeight > 1
    ? el.clientHeight
    : (Number(globalThis.innerHeight) || 720);
  return { width, height };
}

/**
 * Coordinates dual-hand AR input for desktop:
 * 1. Dual pinch (highest): hands spread → move forward, hands close → move back
 * 2. Single pinch on equipment: direct manipulation
 * 3. Single pinch in empty space: look around (smoothed aim follow)
 */
export function createArInteractionController({
  getHandState,
  beginManipulation,
  updateManipulation,
  endManipulation,
  onLook,
  onPhaseChange,
  dollyOptions = {},
  lookOptions = {},
  trackingLossGraceMs = DEFAULT_TRACKING_LOSS_GRACE_MS,
} = {}) {
  // Hand landmarks are filtered before they reach this controller. A larger
  // dead zone makes deliberate, slow two-hand spreading indistinguishable
  // from stillness, so retain sub-pixel NDC sensitivity for dolly movement.
  const dollyGain = Number.isFinite(dollyOptions.gain) ? dollyOptions.gain : 48;
  const dollyDeadZone = Number.isFinite(dollyOptions.deadZone) ? dollyOptions.deadZone : 0.0008;

  // One Euro keeps slow aiming quiet while preserving intentional flicks.
  const lookMinCutoff = Number.isFinite(lookOptions.minCutoff) ? lookOptions.minCutoff : 0.9;
  const lookBeta = Number.isFinite(lookOptions.beta) ? lookOptions.beta : 0.55;
  const lookDCutoff = Number.isFinite(lookOptions.dCutoff) ? lookOptions.dCutoff : 1;
  const lookSensitivity = Number.isFinite(lookOptions.sensitivity) ? lookOptions.sensitivity : 1.25;
  const lookOutputFollow = Number.isFinite(lookOptions.outputFollow) ? lookOptions.outputFollow : 22;
  const lookMaxStepPx = Number.isFinite(lookOptions.maxStepPx) ? lookOptions.maxStepPx : 48;

  const pinching = { Left: false, Right: false };
  const movement = { strafe: 0, forward: 0 };
  const snapshot = {
    active: false,
    phase: 'idle',
    label: PHASE_LABELS.idle,
    movement,
    dualNavigating: false,
    manipulating: false,
    looking: false,
  };

  const lookFilterX = new OneEuroScalar({
    minCutoff: lookMinCutoff,
    beta: lookBeta,
    dCutoff: lookDCutoff,
  });
  const lookFilterY = new OneEuroScalar({
    minCutoff: lookMinCutoff,
    beta: lookBeta,
    dCutoff: lookDCutoff,
  });
  const lookOutput = { x: 0, y: 0 };
  let lookFilterReady = false;
  let lookLastFiltered = { x: 0, y: 0 };
  let lookLastMs = null;

  let enabled = false;
  let dualNavigating = false;
  let dualLastDistance = null;
  let lookingHand = null;
  let manipulation = null;
  let lastPhase = '';
  let lastTrackedAt = -Infinity;

  function setEnabled(next) {
    enabled = !!next;
    snapshot.active = enabled;
    if (!enabled) reset({ cancelled: true });
  }

  function clearMovement() {
    movement.strafe = 0;
    movement.forward = 0;
  }

  function resetLookFilter() {
    lookFilterX.reset();
    lookFilterY.reset();
    lookFilterReady = false;
    lookLastFiltered.x = 0;
    lookLastFiltered.y = 0;
    lookOutput.x = 0;
    lookOutput.y = 0;
    lookLastMs = null;
  }

  function endLooking() {
    lookingHand = null;
    snapshot.looking = false;
    resetLookFilter();
  }

  function endCurrentManipulation({ cancelled = false, event = null } = {}) {
    if (!manipulation) return;
    endManipulation?.({
      ...(event || manipulation.startEvent || {}),
      hand: manipulation.hand,
      target: manipulation.target,
      hoverTarget: event && Object.prototype.hasOwnProperty.call(event, 'hoverTarget')
        ? event.hoverTarget
        : manipulation.hoverTarget,
      totalX: manipulation.totalX,
      totalY: manipulation.totalY,
      dragged: manipulation.dragged,
      cancelled,
    });
    manipulation = null;
    snapshot.manipulating = false;
  }

  function exitDualNavigation() {
    dualNavigating = false;
    dualLastDistance = null;
    snapshot.dualNavigating = false;
    clearMovement();
  }

  function interHandDistance() {
    const left = getHandState?.('Left');
    const right = getHandState?.('Right');
    const leftPos = left?.ndc || left?.palmNdc;
    const rightPos = right?.ndc || right?.palmNdc;
    if (!leftPos || !rightPos) return null;
    const lx = Number(leftPos.x);
    const ly = Number(leftPos.y);
    const rx = Number(rightPos.x);
    const ry = Number(rightPos.y);
    if (![lx, ly, rx, ry].every(Number.isFinite)) return null;
    return Math.hypot(lx - rx, ly - ry);
  }

  function enterDualNavigation() {
    // Dual pinch always wins over look and equipment manipulation.
    endLooking();
    endCurrentManipulation({ cancelled: true });
    dualNavigating = true;
    dualLastDistance = interHandDistance();
    snapshot.dualNavigating = true;
    clearMovement();
  }

  function isEquipmentTarget(target) {
    if (!target) return false;
    // Reject resolveTarget wrappers like { target: null, distance } that are truthy but empty.
    if (
      !target.isObject3D
      && Object.prototype.hasOwnProperty.call(target, 'target')
      && Object.prototype.hasOwnProperty.call(target, 'distance')
    ) {
      return false;
    }
    return true;
  }

  function beginSingleHandAction(hand, event) {
    // Pinch maps to mouse down + click: always attempt beginManipulation first
    // (ray-based click). If it returns true, stay in manipulating.
    // If nothing was hit or interaction was rejected, fall back to smoothed look.
    endLooking();
    const hinted = isEquipmentTarget(event?.target) ? event.target : null;
    const clickEvent = { ...event, target: hinted, dragged: false };
    const hit = typeof beginManipulation === 'function'
      ? beginManipulation(clickEvent)
      : !!hinted;
    const shouldManipulate = hit === true || (hit !== false && !!hinted);
    if (shouldManipulate) {
      manipulation = {
        hand,
        target: clickEvent.target || hinted || null,
        hoverTarget: event?.hoverTarget || hinted || null,
        totalX: 0,
        totalY: 0,
        dragged: false,
        startEvent: event,
      };
      snapshot.manipulating = true;
      return;
    }
    // True empty space or unhit surface → smoothed look (mouse-free orbit).
    lookingHand = hand;
    snapshot.looking = true;
    resetLookFilter();
  }

  function resumeRemainingHand(hand) {
    if (!hand || !pinching[hand]) return;
    const state = getHandState?.(hand);
    const target = state?.lockedTarget || state?.liveTarget || null;
    beginSingleHandAction(hand, {
      hand,
      target,
      hoverTarget: state?.liveTarget || target,
      raycaster: state?.raycaster || null,
      ndc: state?.ndc || null,
    });
  }

  function otherHand(hand) {
    return hand === 'Left' ? 'Right' : hand === 'Right' ? 'Left' : null;
  }

  function bothPinching() {
    return pinching.Left && pinching.Right;
  }

  function updateSmoothLook(nowMs) {
    if (!lookingHand || manipulation || dualNavigating) return;

    const state = getHandState?.(lookingHand);
    const ndc = state?.ndc || state?.palmNdc;
    const x = Number(ndc?.x);
    const y = Number(ndc?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const dt = lookLastMs == null
      ? 1 / 60
      : clamp((nowMs - lookLastMs) / 1000, 1 / 240, 0.05);
    lookLastMs = nowMs;

    const filteredX = lookFilterX.filter(x, nowMs);
    const filteredY = lookFilterY.filter(y, nowMs);

    if (!lookFilterReady) {
      lookFilterReady = true;
      lookLastFiltered.x = filteredX;
      lookLastFiltered.y = filteredY;
      lookOutput.x = 0;
      lookOutput.y = 0;
      return;
    }

    const { width, height } = viewportSize();
    // Match handTracking drag sign convention (ndc → pixel-ish deltas).
    const targetDx = (filteredX - lookLastFiltered.x) * width * 0.5 * lookSensitivity;
    const targetDy = (filteredY - lookLastFiltered.y) * height * -0.5 * lookSensitivity;
    lookLastFiltered.x = filteredX;
    lookLastFiltered.y = filteredY;

    // Second-stage exponential blend removes remaining quantization from low tracking rates.
    const outAlpha = 1 - Math.exp(-lookOutputFollow * dt);
    lookOutput.x += (targetDx - lookOutput.x) * outAlpha;
    lookOutput.y += (targetDy - lookOutput.y) * outAlpha;

    const magnitude = Math.hypot(lookOutput.x, lookOutput.y);
    if (magnitude > lookMaxStepPx) {
      const scale = lookMaxStepPx / magnitude;
      lookOutput.x *= scale;
      lookOutput.y *= scale;
    }

    if (magnitude > 0.015) {
      onLook?.(lookOutput.x, lookOutput.y);
    }
  }

  function reset({ cancelled = false } = {}) {
    endCurrentManipulation({ cancelled });
    endLooking();
    exitDualNavigation();
    pinching.Left = false;
    pinching.Right = false;
    setPhase(enabled ? 'idle' : 'idle');
  }

  function setPhase(phase) {
    snapshot.phase = phase;
    snapshot.label = PHASE_LABELS[phase] || phase;
    if (phase !== lastPhase) {
      lastPhase = phase;
      onPhaseChange?.(snapshot);
    }
  }

  function update(nowMs = performance.now()) {
    if (!enabled) return snapshot;

    const left = getHandState?.('Left') || null;
    const right = getHandState?.('Right') || null;
    const leftTracked = !!(left?.visible && left?.trackingVisible);
    const rightTracked = !!(right?.visible && right?.trackingVisible);
    if (leftTracked || rightTracked) lastTrackedAt = nowMs;
    const trackingGraceActive = !leftTracked
      && !rightTracked
      && nowMs - lastTrackedAt <= trackingLossGraceMs;

    if (dualNavigating && bothPinching()) {
      if (!leftTracked || !rightTracked) {
        clearMovement();
      } else {
        const distance = interHandDistance();
        if (distance == null) {
          clearMovement();
        } else if (dualLastDistance == null) {
          dualLastDistance = distance;
          clearMovement();
        } else {
          const delta = distance - dualLastDistance;
          dualLastDistance = distance;
          if (Math.abs(delta) <= dollyDeadZone) {
            movement.forward = 0;
          } else {
            // Spread apart → forward; pinch together → backward.
            movement.forward = clamp(delta * dollyGain, -1, 1);
          }
          movement.strafe = 0;
        }
      }
    } else if (!dualNavigating) {
      clearMovement();
    }

    // Drive look every animation frame from filtered hand aim (not sparse drag events).
    updateSmoothLook(nowMs);

    snapshot.dualNavigating = dualNavigating;
    snapshot.manipulating = !!manipulation;
    snapshot.looking = !!lookingHand;

    if (dualNavigating) setPhase('navigating');
    else if (manipulation) setPhase('manipulating');
    else if (lookingHand) setPhase('looking');
    else if (!leftTracked && !rightTracked && !trackingGraceActive) setPhase('tracking-lost');
    else setPhase('idle');

    return snapshot;
  }

  function onPinchStart(event) {
    if (!enabled) return false;
    const hand = event?.hand;
    if (hand !== 'Left' && hand !== 'Right') return false;

    pinching[hand] = true;

    if (bothPinching()) {
      enterDualNavigation();
      return true;
    }

    // Single-hand: equipment interaction takes priority over look.
    beginSingleHandAction(hand, event);
    return true;
  }

  function onPinchMove(event) {
    if (!enabled) return false;
    const hand = event?.hand;
    if (hand !== 'Left' && hand !== 'Right') return false;

    // Dual navigation is driven by inter-hand distance in update().
    if (dualNavigating || bothPinching()) return false;

    if (manipulation && manipulation.hand === hand) {
      manipulation.totalX += Number(event.dx || 0);
      manipulation.totalY += Number(event.dy || 0);
      if (Object.prototype.hasOwnProperty.call(event, 'hoverTarget')) {
        manipulation.hoverTarget = event.hoverTarget;
      }
      if (Math.hypot(manipulation.totalX, manipulation.totalY) >= 8) {
        manipulation.dragged = true;
      }
      updateManipulation?.({
        ...event,
        target: manipulation.target,
        hoverTarget: manipulation.hoverTarget,
        totalX: manipulation.totalX,
        totalY: manipulation.totalY,
        dragged: manipulation.dragged,
      });
      return true;
    }

    // Looking is applied in update() via smoothed aim follow.
    if (lookingHand === hand && !manipulation) return true;

    return false;
  }

  function onPinchEnd(event) {
    if (!enabled) return false;
    const hand = event?.hand;
    if (hand !== 'Left' && hand !== 'Right') return false;

    const wasDual = dualNavigating || bothPinching();
    pinching[hand] = false;

    if (wasDual) {
      exitDualNavigation();
      // Remaining pinched hand falls back to equipment/look priority.
      resumeRemainingHand(otherHand(hand));
      return true;
    }

    if (manipulation?.hand === hand) {
      endCurrentManipulation({ cancelled: !!event?.cancelled, event });
    }
    if (lookingHand === hand) {
      endLooking();
    }
    return true;
  }

  return {
    setEnabled,
    reset,
    update,
    onPinchStart,
    onPinchMove,
    onPinchEnd,
    getState: () => snapshot,
    isManipulating: () => !!manipulation,
    isLooking: () => !!lookingHand,
    isDualNavigating: () => dualNavigating,
  };
}
