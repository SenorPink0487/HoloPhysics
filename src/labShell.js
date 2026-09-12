import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createMaterials } from './scene/shared/materials.js';
import { createPrimitives } from './scene/shared/primitives.js';
import { createSharedProps } from './scene/shared/labProps.js';
import { getAppInfo, installTauriWindowLifecycle, isTauri } from './tauri.js';
import { createLabLoader } from './loader.js';
import {
  drawHoloScreen,
  getHoloScreenLayoutSize,
  isParamSliderAction,
  pickHoloScreen,
  uvFromRayAndMesh,
  valueFromParamSliderPick,
} from './holoScreen.js';
import { drawFormulaBoard, pickFormulaBoard, FORMULA_CATALOG } from './formulaBoard.js';
import { resolveFrontmostInteraction, apparatusBeatsHolo } from './raycastInteraction.js';
import {
  mountUi,
  updateArStatus,
  updateHud,
  updateToast,
  updateTutorial,
} from './ui/main.jsx';
import { labFrameScheduler } from './frameBudget.js';
import { createStationPresence } from './runtime/stationPresence.js';
import { labOpenTiming } from './runtime/openTiming.js';
import { createRuntimeCache, runtimeCacheBudget } from './runtime/runtimeCache.js';
import { createShaderWarmupController } from './runtime/shaderWarmup.js';
import { createContentScreenRegistry } from './runtime/contentScreenReuse.js';
import { normalizeJoystickInput } from './touchControls.js';
import {
  createExperimentRuntime,
  createTransitionController,
} from './runtime/experimentRuntime.js';
import { createFrameCoordinator } from './runtime/frameCoordinator.js';
import { createSimDriver } from './runtime/simDriver.js';
import { createRenderBackend } from './runtime/threading/renderBackend.js';
import { createPhysicsPostProcessing } from './runtime/postprocessing.js';
import { createHoloFullscreenController } from './runtime/holoFullscreen.js';
import { formatExperimentData } from './ui/experimentDataSummary.js';
import {
  defineInteractionTarget,
  findInteractionHost,
  hasInteractionMethod,
  INTERACTION_KIND,
  isInteractionKind,
} from './runtime/interactionContract.js';
import {
  createPerformanceGovernor,
  HIGH_QUALITY_PROFILE,
} from './runtime/performanceGovernor.js';
import { createDeskSliderPanel } from './scene/shared/deskSliders.js';
import { getDeskSliderConfig, readDeskSliderValue } from './deskSliderCatalog.js';
import {
  loadStationModule,
  loadStationExperimentModule,
  loadStationExperimentRuntime,
  loadExperimentModule,
  preloadStation,
} from './runtime/moduleLoader.js';
import {
  LAB_CATALOG,
  STATION_EXPERIMENTS,
  STATION_IDS,
  findExperiment,
  registerStationCatalog,
  stationIdsForMode,
  PHYSICS_STATION_IDS,
} from './runtime/catalog.js';

const BOOT_STATION_IDS = PHYSICS_STATION_IDS;
let _lastFocusedTarget = null;
let _lastCrosshairCanInteract = null;
const touchDisplay = (
  Number((typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0) > 0
  || ('ontouchstart' in window)
);

/** Continuous track or discrete action chip on the tabletop desk panel. */
function isDeskPanelPick(pick) {
  return !!(pick && (
    isParamSliderAction(pick.action)
    || pick.kind === 'action'
    || pick.role === 'desk_action'
  ));
}

/** One-shot desk button (e.g. 记录当前读数) — fire uiAction, do not drag. */
function isDeskActionPick(pick) {
  return !!(pick && (pick.kind === 'action' || pick.role === 'desk_action') && pick.action);
}

// Feed heavy frame-budget jobs into open-timing sessions (measure scripts).
labFrameScheduler.setJobTimedListener?.((id, dtMs) => {
  try { labOpenTiming.recordJob(id, dtMs); } catch { /* ignore */ }
});

// Keep a compact, rolling stage breakdown for the switch-performance probe.
// It deliberately stores maxima only: recording every frame would itself add
// allocation pressure to the path we are measuring.
const switchFrameMetrics = {
  active: false,
  frames: 0,
  maxFrameMs: 0,
  stages: {},
};

function beginSwitchFrameMetrics() {
  switchFrameMetrics.active = true;
  switchFrameMetrics.frames = 0;
  switchFrameMetrics.maxFrameMs = 0;
  switchFrameMetrics.stages = {};
}

function noteSwitchStage(name, dtMs) {
  if (!switchFrameMetrics.active || !Number.isFinite(dtMs)) return;
  const prev = switchFrameMetrics.stages[name] || 0;
  if (dtMs > prev) switchFrameMetrics.stages[name] = Number(dtMs.toFixed(2));
}

/** Rolling frame / long-task stats for measure:perf and __labDebug. */
const labPerfStats = {
  bootMs: null,
  firstFrameMs: null,
  frameSamples: [],
  frameSampleWrite: 0,
  frameGaps: [],
  longTaskMax: 0,
  switchSamples: [],
  requestLog: [],
  initialJsGzip: null,
  initialImageBytes: null,
};

/**
 * Intent gate for predictive station preload.
 * Declared early: DEV preview / menu open call markUserIntent() during module
 * evaluation, before the later predictStationPreload block would run.
 */
let userIntentSeen = false;
function markUserIntent() {
  userIntentSeen = true;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function labPerfSnapshot() {
  const frames = labPerfStats.frameSamples.slice().sort((a, b) => a - b);
  const switches = labPerfStats.switchSamples.slice().sort((a, b) => a - b);
  const gaps = labPerfStats.frameGaps.slice().sort((a, b) => a - b);
  return {
    bootMs: labPerfStats.bootMs,
    firstFrameMs: labPerfStats.firstFrameMs,
    initialJsGzip: labPerfStats.initialJsGzip,
    initialImageBytes: labPerfStats.initialImageBytes,
    requestLog: labPerfStats.requestLog.slice(),
    frameP95: Number(percentile(frames, 95).toFixed(2)),
    frameP50: Number(percentile(frames, 50).toFixed(2)),
    switchP99: Number(percentile(switches, 99).toFixed(2)),
    switchP95: Number(percentile(switches, 95).toFixed(2)),
    maxFrameGap: gaps[gaps.length - 1] || 0,
    longTaskMax: labPerfStats.longTaskMax,
    frameSamples: labPerfStats.frameSamples.length,
  };
}

/** Set after equipment is built; used by idle animators & interaction */
let expManager = null;

const labLoader = createLabLoader();
labLoader.setProgress(0.04, '初始化渲染核心…');

/** One animation frame (for paint + CSS compositor). */
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** Double-rAF: one layout/paint + one composite frame (CSS anims catch up). */
function nextPaint() {
  return nextFrame().then(() => nextFrame());
}

/**
 * Prefer MessageChannel for a true macrotask (does not coalesce like setTimeout(0)
 * under load). Falls back to setTimeout when MessageChannel is unavailable.
 * @returns {Promise<void>}
 */
function yieldMacrotask() {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
      return;
    }
    setTimeout(resolve, 0);
  });
}

/**
 * Return control to the browser so the loader can paint and chrome stays
 * responsive (tabs / back / address bar). CSS loader motion only advances when
 * the main thread is free long enough for the compositor.
 * @param {number} [minIdleMs]
 */
function yieldToBrowser(minIdleMs = 0) {
  const wait = Math.max(0, Number(minIdleMs) || 0);
  const t0 = performance.now();
  return yieldMacrotask().then(async () => {
    await nextPaint();
    const spent = performance.now() - t0;
    const remain = wait - spent;
    if (remain > 1) {
      await new Promise((r) => setTimeout(r, remain));
      await nextFrame();
    }
  });
}

/**
 * Run a heavy sync chunk, then force a browser idle slice proportional to cost.
 * Used for room/proxy construction under the loader — not full-lab GPU warm.
 * @template T
 * @param {() => T} fn
 * @param {{ minIdleMs?: number, paintFirst?: boolean, maxRestMs?: number }} [opts]
 * @returns {Promise<T>}
 */
async function runHeavyChunk(fn, opts = {}) {
  const minIdleMs = opts.minIdleMs ?? 12;
  const maxRestMs = opts.maxRestMs ?? 56;
  // Paint any progress/status the caller just wrote before we block.
  if (opts.paintFirst !== false) {
    await nextPaint();
  }
  const t0 = performance.now();
  let result;
  try {
    result = fn();
  } finally {
    const elapsed = performance.now() - t0;
    // Adaptive rest: long compiles must not starve the loader for multiple frames.
    // floor grows with cost; cap keeps total boot finite.
    const proportional = Math.ceil(elapsed * 0.85);
    const floor = elapsed > 48
      ? 32
      : elapsed > 24
        ? 22
        : elapsed > 12
          ? 16
          : minIdleMs;
    const rest = Math.min(maxRestMs, Math.max(floor, proportional, minIdleMs));
    await yieldToBrowser(rest);
    // Extra composite pass after multi-frame stalls so ring/bar resume smoothly.
    if (elapsed > 20) {
      await nextPaint();
    }
  }
  return result;
}

// Desktop shell detection (no-op on pure web / Vite preview)
if (isTauri()) {
  getAppInfo().then((info) => {
    if (info) console.info(`[Tauri] ${info.name} v${info.version}`);
  }).catch(() => {});
}

// ═══════════════════════════════════════════════
//  Renderer — bright cinematic look
// ═══════════════════════════════════════════════
const canvas = document.getElementById('c');
const isEditableTouchTarget = (target) => !!target?.closest?.(
  'input, textarea, select, [contenteditable="true"]',
);
// iPadOS treats a sustained finger as text/image selection even inside some
// WebView overlays. Suppress native selection/callouts across the lab while
// preserving normal editing in the chemistry search input.
document.addEventListener('contextmenu', (event) => {
  if (!isEditableTouchTarget(event.target)) event.preventDefault();
});
document.addEventListener('selectstart', (event) => {
  if (!isEditableTouchTarget(event.target)) event.preventDefault();
});
document.addEventListener('dragstart', (event) => {
  if (!isEditableTouchTarget(event.target)) event.preventDefault();
});
// Keep compute off the UI thread on the web whenever Workers are available.
// The backends still fall back to main when a browser/WebView refuses module
// workers or SharedArrayBuffer.
// iPad WKWebView can construct a module Worker successfully yet stop
// delivering pose batches after the app is backgrounded or the camera starts.
// Use the deterministic main backend there; desktop/web retain worker auto mode.
globalThis.__PHYSICS_BACKEND_MODE__ ??= touchDisplay ? 'main' : 'auto';
globalThis.__SIM_BACKEND_MODE__ ??= touchDisplay ? 'main' : 'auto';
globalThis.__SIM_WORKER_POOL_SIZE__ ??= 2;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
// EffectComposer renders several passes per frame. Accumulate renderer.info
// across the complete frame so the performance panel reports the real scene
// workload instead of only the final fullscreen output pass.
renderer.info.autoReset = false;
// Use the device's native DPR. Keep one stable render-target size across
// experiment switches so WebGL does not reallocate the backbuffer unnecessarily.
let labPostProcessing = null;
// Preserve the established HoloPhysics look by default. The new composer is
// opt-in for visual/performance experiments; switching experiments never
// changes the production lighting pipeline implicitly.
const POST_PROCESSING_ENABLED = new URLSearchParams(window.location.search).has('post')
  && !new URLSearchParams(window.location.search).has('noPost');
const performanceGovernor = createPerformanceGovernor({
  renderer,
  quality: HIGH_QUALITY_PROFILE,
  onStatusChange: (status, snapshot) => {
    if (status !== 'warning') return;
    showToast(
      `固定高画质下 FPS ${snapshot.fps.toFixed(0)} · `
      + `Render ${snapshot.renderMs.toFixed(1)}ms · `
      + `CPU ${snapshot.frameMs.toFixed(1)}ms。建议关闭其他高负载应用。`,
    );
  },
});

/**
 * CSS layout box of #c — the only size that must drive camera aspect + drawing
 * buffer. window.innerWidth/Height can diverge (iframe under a title bar, DPI
 * snap, setSize(updateStyle=true) baking stale inline px) and then the scene
 * is anamorphically stretched: crosshair stays centered but hits feel "歪"
 * until F11 forces a clean resize. Always pair with setSize(..., false) so
 * stylesheet `width/height: 100%` owns the element box.
 */
function getLabViewportSize() {
  const cw = Math.max(1, Math.floor(canvas?.clientWidth || 0));
  const ch = Math.max(1, Math.floor(canvas?.clientHeight || 0));
  if (cw > 1 && ch > 1) return { width: cw, height: ch };
  return {
    width: Math.max(1, Math.floor(window.innerWidth || 1)),
    height: Math.max(1, Math.floor(window.innerHeight || 1)),
  };
}

function getLabPixelRatio(requested = window.devicePixelRatio || 1) {
  return Math.max(0.5, Number(requested) || 1);
}

function clearCanvasInlineSize() {
  // Three.js setSize(w,h,true) writes inline px that then fight % layout.
  if (canvas.style.width) canvas.style.width = '';
  if (canvas.style.height) canvas.style.height = '';
}

function applyLabViewportSize({ updateCamera = true, pixelRatio = null } = {}) {
  clearCanvasInlineSize();
  const { width, height } = getLabViewportSize();
  if (pixelRatio != null && Number.isFinite(pixelRatio)) {
    renderer.setPixelRatio(getLabPixelRatio(pixelRatio));
  }
  renderer.setSize(width, height, false);
  labPostProcessing?.resize(width, height, renderer.getPixelRatio?.() || 1);
  if (updateCamera && camera) {
    const nextAspect = width / Math.max(height, 1);
    if (Math.abs(camera.aspect - nextAspect) > 1e-6) {
      camera.aspect = nextAspect;
      camera.updateProjectionMatrix();
    }
  }
  return { width, height };
}

renderer.setPixelRatio(getLabPixelRatio());
if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = 0.5;
// updateStyle=false: keep #c on stylesheet 100%/100% (never bake inner* into inline px).
applyLabViewportSize({ updateCamera: false });
renderer.shadowMap.enabled = true;
// Soft PCF is roughly 2–4× the shadow-map cost of basic PCF on large rooms.
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
let shadowRefreshRequested = true;
let nextShadowRefreshAt = 0;
let shadowRefreshIntervalMs = 1000 / 30;
function requestShadowRefresh() {
  shadowRefreshRequested = true;
}
function scheduleShadowRefresh(nowMs, { switching = false, dynamic = false } = {}) {
  if (switching) shadowRefreshIntervalMs = 1000 / 15;
  else if (dynamic) shadowRefreshIntervalMs = 1000 / 30;
  else return;
  // Shadow-map rendering is synchronous on WebGL/ANGLE. Do not rebuild the
  // whole room merely because an experiment is switching or simulating; only
  // an explicit graph change that actually needs new casters should request it.
  // This keeps a mechanics open from blocking on the room's 319 static casters.
  if (shadowRefreshRequested) {
    renderer.shadowMap.needsUpdate = true;
    shadowRefreshRequested = false;
    nextShadowRefreshAt = nowMs + shadowRefreshIntervalMs;
  }
}
// If any MeshPhysical transmission sneaks back in, keep the RT tiny.
if ('transmissionResolutionScale' in renderer) {
  renderer.transmissionResolutionScale = 0.25;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Preserve the original HoloPhysics exposure; performance work must not alter
// the established room lighting or material response.
renderer.toneMappingExposure = 1.35;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd6ecff);
scene.fog = new THREE.FogExp2(0xd6ecff, 0.018);

const _bootView = getLabViewportSize();
const camera = new THREE.PerspectiveCamera(68, _bootView.width / Math.max(_bootView.height, 1), 0.06, 60);
// PointerLockControls uses YXZ internally. Keep every camera look path on the
// same order so touch/AR yaw + pitch cannot introduce an unintended roll.
camera.rotation.order = 'YXZ';
// Re-sync buffer now that camera exists (init setSize ran with updateCamera:false).
applyLabViewportSize({
  updateCamera: true,
  pixelRatio: getLabPixelRatio(),
});
if (POST_PROCESSING_ENABLED) {
  labPostProcessing = createPhysicsPostProcessing({
    renderer,
    scene,
    camera,
    quality: HIGH_QUALITY_PROFILE,
  });
  labPostProcessing.resize(
    _bootView.width,
    _bootView.height,
    window.devicePixelRatio || 1,
  );
}
// Spawn in front of the electromagnetism workstation table facing the apparatus.
camera.position.set(-4.2, 1.65, 4.7);
camera.lookAt(-4.2, 1.28, 0);

labLoader.setProgress(0.08, '构建实验室空间…');

// ═══════════════════════════════════════════════
//  Controls
// ═══════════════════════════════════════════════
const controls = new PointerLockControls(camera, document.body);
const cameraLookEuler = new THREE.Euler(0, 0, 0, 'YXZ');

/** Apply yaw/pitch without allowing camera roll to accumulate. */
function applyCameraLookDelta(dx, dy, {
  sensitivityX,
  sensitivityY,
  minPitch = -1.35,
  maxPitch = 1.35,
} = {}) {
  camera.rotation.order = 'YXZ';
  cameraLookEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  cameraLookEuler.y -= Number(dx || 0) * sensitivityX;
  cameraLookEuler.x = THREE.MathUtils.clamp(
    cameraLookEuler.x - Number(dy || 0) * sensitivityY,
    minPitch,
    maxPitch,
  );
  // A first-person look camera should never bank. Rebuild the quaternion from
  // the yaw/pitch pair instead of mutating Euler x/y in the current order.
  cameraLookEuler.z = 0;
  camera.quaternion.setFromEuler(cameraLookEuler);
}

canvas.addEventListener('click', () => {
  if (document.body.classList.contains('is-loading')) return;
  if (holoFsState?.open) return; // fullscreen UI owns the mouse
  if (helpModalWrapEl?.classList.contains('is-open')) return; // help modal owns mouse
  // AR owns camera navigation and scene interaction while it is active.
  // Entering pointer lock here would leave MediaPipe running but disable the
  // AR interaction controller, which looks like “hands detected, no control”.
  if (handTracking?.isActive()) return;
  // A charge can be dragged directly from the unlocked view.  Do not let the
  // click that follows that drag unexpectedly engage pointer-lock navigation.
  if (gaussPointerDrag?.suppressClick) {
    gaussPointerDrag.suppressClick = false;
    return;
  }
  if (!controls.isLocked) controls.lock();
});
controls.addEventListener('lock', () => {
  if (handTracking?.isActive()) {
    controls.unlock();
    return;
  }
  document.body.classList.add('locked');
  // Pointer-lock mouse input is an explicit desktop interaction mode.  Pause
  // AR gesture callbacks while it is active so a visible hand cannot compete
  // with the mouse for the same experiment target.
  arInteractionController?.setEnabled(false);
});
controls.addEventListener('unlock', () => {
  document.body.classList.remove('locked');
  if (handTracking?.isActive()) arInteractionController?.setEnabled(true);
});

const move = { forward: false, back: false, left: false, right: false, up: false, down: false };
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const arVelocity = new THREE.Vector2();
const SPEED = 4.5;
const AR_SPEED = 2.2;
/** Dual-hand pinch dolly is intentional locomotion — keep it snappier and longer-range. */
const AR_DOLLY_SPEED = 6.2;
const mobileJoystick = document.getElementById('mobile-joystick');
const mobileJoystickKnob = document.getElementById('mobile-joystick-knob');
const mobileLiftUp = document.getElementById('mobile-lift-up');
const mobileLiftDown = document.getElementById('mobile-lift-down');
const touchStick = { x: 0, y: 0, magnitude: 0, pointerId: null };
let touchNavigationActive = false;
const touchLook = { pointerId: null, lastX: 0, lastY: 0 };
const touchMove = {
  pointers: new Map(),
  previousDistance: null,
};
// A touch that starts on a draggable apparatus or a live screen control owns
// the whole pointer stream. Otherwise the capture-phase camera gesture below
// rotates the view before the experiment drag bridge receives pointermove.
let touchDragPointerId = null;

function clearTouchMove() {
  touchMove.previousDistance = null;
  move.forward = false;
  move.back = false;
}

function cancelTouchGesture() {
  if (touchDragPointerId != null) {
    finishUnlockedElectroDrag({ pointerId: touchDragPointerId }, true);
  }
  touchDragPointerId = null;
  touchMove.pointers.clear();
  touchLook.pointerId = null;
  clearTouchMove();
}

function resetTouchStick() {
  touchStick.x = 0;
  touchStick.y = 0;
  touchStick.magnitude = 0;
  touchStick.pointerId = null;
  move.left = false;
  move.right = false;
  move.forward = false;
  move.back = false;
  touchNavigationActive = move.up || move.down;
  mobileJoystick?.classList.remove('is-active');
  if (mobileJoystickKnob) mobileJoystickKnob.style.transform = 'translate3d(-50%, -50%, 0)';
}

function updateTouchStick(event) {
  if (!mobileJoystick) return;
  const rect = mobileJoystick.getBoundingClientRect();
  const radius = rect.width * 0.34;
  const dx = event.clientX - (rect.left + rect.width / 2);
  const dy = event.clientY - (rect.top + rect.height / 2);
  const input = normalizeJoystickInput(dx, dy, radius);
  touchStick.x = input.x;
  touchStick.y = input.y;
  touchStick.magnitude = input.magnitude;
  touchNavigationActive = input.magnitude > 0;
  move.left = input.x < -0.12;
  move.right = input.x > 0.12;
  move.forward = input.y < -0.12;
  move.back = input.y > 0.12;
  const rawLength = Math.hypot(dx, dy);
  const visualLength = Math.min(rawLength, radius);
  const vx = rawLength ? (dx / rawLength) * visualLength : 0;
  const vy = rawLength ? (dy / rawLength) * visualLength : 0;
  mobileJoystick.classList.toggle('is-active', input.magnitude > 0);
  if (mobileJoystickKnob) mobileJoystickKnob.style.transform = `translate3d(calc(-50% + ${vx}px), calc(-50% + ${vy}px), 0)`;
}

function setTouchLift(axis, active) {
  touchNavigationActive = active || touchStick.magnitude > 0;
  move[axis] = active;
}

function bindTouchButton(button, axis) {
  if (!button) return;
  const release = (event) => {
    if (event?.pointerId != null && button.dataset.pointerId !== String(event.pointerId)) return;
    button.dataset.pointerId = '';
    button.classList.remove('is-active');
    setTouchLift(axis, false);
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    button.dataset.pointerId = String(event.pointerId);
    button.setPointerCapture?.(event.pointerId);
    button.classList.add('is-active');
    setTouchLift(axis, true);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, release);
}

mobileJoystick?.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' || touchStick.pointerId != null) return;
  event.preventDefault();
  event.stopPropagation();
  touchStick.pointerId = event.pointerId;
  mobileJoystick.setPointerCapture?.(event.pointerId);
  updateTouchStick(event);
});
mobileJoystick?.addEventListener('pointermove', (event) => {
  if (event.pointerId !== touchStick.pointerId) return;
  event.preventDefault();
  updateTouchStick(event);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  mobileJoystick?.addEventListener(name, (event) => {
    if (event.pointerId === touchStick.pointerId) resetTouchStick();
  });
}
bindTouchButton(mobileLiftUp, 'up');
bindTouchButton(mobileLiftDown, 'down');
window.addEventListener('blur', () => {
  resetTouchStick();
  cancelTouchGesture();
  move.up = false;
  move.down = false;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    resetTouchStick();
    cancelTouchGesture();
    move.up = false;
    move.down = false;
  }
});

function updateTouchMove() {
  if (touchMove.pointers.size < 2) {
    clearTouchMove();
    return;
  }
  const [a, b] = [...touchMove.pointers.values()];
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  if (touchMove.previousDistance == null) {
    touchMove.previousDistance = distance;
    return;
  }
  const delta = distance - touchMove.previousDistance;
  touchMove.previousDistance = distance;
  if (Math.abs(delta) < 1.5) return;
  // Two fingers spreading apart = forward; pinching inward = backward.
  move.forward = delta > 0;
  move.back = delta < 0;
}

// iPad camera look: swipe the scene to orbit the first-person camera.
canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'touch' || holoFsState?.open || handTracking?.isActive()) return;

  // Reserve the first finger on an apparatus/control for the experiment. Do
  // not stop propagation here: the normal unlocked drag bridge, registered
  // later in this module, still needs to run its beginManipulation path.
  // Additional fingers are ignored while a drag is active so they cannot
  // accidentally turn the camera while the user is moving equipment.
  if (touchDragPointerId != null) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const hasExistingSceneGesture = touchLook.pointerId != null || touchMove.pointers.size > 0;
  if (!hasExistingSceneGesture && !controls.isLocked) {
    const picked = unlockedElectroPick(event);
    if (picked) {
      touchDragPointerId = event.pointerId;
      event.preventDefault();
      return;
    }
  }

  touchMove.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (touchMove.pointers.size >= 2) {
    touchLook.pointerId = null;
    updateTouchMove();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  touchLook.pointerId = event.pointerId;
  touchLook.lastX = event.clientX;
  touchLook.lastY = event.clientY;
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}, { capture: true, passive: false });
window.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'touch' || handTracking?.isActive()) return;
  if (touchDragPointerId != null) {
    // The active apparatus pointer must bubble to the drag bridge. Suppress
    // only additional fingers so they cannot start a competing camera move.
    if (event.pointerId !== touchDragPointerId) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  if (touchMove.pointers.has(event.pointerId)) {
    touchMove.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchMove.pointers.size >= 2) {
      updateTouchMove();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }
  if (event.pointerId !== touchLook.pointerId) return;
  const dx = event.clientX - touchLook.lastX;
  const dy = event.clientY - touchLook.lastY;
  touchLook.lastX = event.clientX;
  touchLook.lastY = event.clientY;
  applyCameraLookDelta(dx, dy, {
    sensitivityX: 0.006,
    sensitivityY: 0.004,
  });
  event.preventDefault();
  event.stopPropagation();
}, { capture: true, passive: false });
window.addEventListener('pointerup', (event) => {
  if (event.pointerId === touchDragPointerId) {
    touchDragPointerId = null;
    return;
  }
  if (touchDragPointerId != null) return;
  touchMove.pointers.delete(event.pointerId);
  if (touchMove.pointers.size < 2) clearTouchMove();
  if (event.pointerId === touchLook.pointerId) touchLook.pointerId = null;
}, { capture: true });
window.addEventListener('pointercancel', (event) => {
  if (event.pointerId === touchDragPointerId) {
    touchDragPointerId = null;
    return;
  }
  if (touchDragPointerId != null) return;
  touchMove.pointers.delete(event.pointerId);
  clearTouchMove();
  touchLook.pointerId = null;
}, { capture: true });

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': move.forward = true; break;
    case 'KeyS': case 'ArrowDown': move.back = true; break;
    case 'KeyA': case 'ArrowLeft': move.left = true; break;
    case 'KeyD': case 'ArrowRight': move.right = true; break;
    case 'Space': move.up = true; e.preventDefault(); break;
    case 'ShiftLeft': case 'ShiftRight': move.down = true; break;
  }
});
document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': move.forward = false; break;
    case 'KeyS': case 'ArrowDown': move.back = false; break;
    case 'KeyA': case 'ArrowLeft': move.left = false; break;
    case 'KeyD': case 'ArrowRight': move.right = false; break;
    case 'Space': move.up = false; break;
    case 'ShiftLeft': case 'ShiftRight': move.down = false; break;
  }
});

// ═══════════════════════════════════════════════
//  Materials — bright sci-fi palette
// ═══════════════════════════════════════════════
const mat = createMaterials();
const primitives = createPrimitives();
const { rbox, box, cyl, sphere, torus } = primitives;
// ═══════════════════════════════════════════════
//  Lighting — bright airy
// ═══════════════════════════════════════════════
labLoader.setProgress(0.12, '配置光照与材质…');
RectAreaLightUniformsLib.init();

const hemi = new THREE.HemisphereLight(0xf0f9ff, 0xb8d4e8, 0.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfffaf0, 1.15);
sun.position.set(6, 16, 5);
sun.castShadow = true;
// Preserve the original shadow footprint; cache/reuse work must not alter
// the established room lighting or shadow edge character.
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const sun2 = new THREE.DirectionalLight(0xc4e4ff, 0.45);
sun2.position.set(-8, 10, -4);
scene.add(sun2);

function addCeilingLight(x, z, w = 2.8, intensity = 5) {
  const light = new THREE.PointLight(0xe8f4ff, 1.0, 10, 1.2);
  light.position.set(x, 3.6, z);
  scene.add(light);

  const g = new THREE.Group();
  g.position.set(x, 3.85, z);
  const housing = rbox(w + 0.2, 0.08, 0.45, mat.white, 0.02);
  g.add(housing);
  const diffuser = rbox(w, 0.04, 0.28, new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xd0e8ff, emissiveIntensity: 1.4, roughness: 0.1, roughness: 0.3,
  }), 0.015);
  diffuser.position.y = -0.04;
  g.add(diffuser);
  // cyan edge LEDs
  const edge = rbox(w + 0.15, 0.015, 0.02, mat.cyanGlow, 0.005);
  edge.position.set(0, -0.02, 0.2);
  g.add(edge);
  scene.add(g);
}

addCeilingLight(-3.8, -2.2);
addCeilingLight(3.8, -2.2);
addCeilingLight(-3.8, 2.5);
addCeilingLight(3.8, 2.5);
addCeilingLight(0, 0, 3.5, 4);

// accent point lights
const accents = [
  { c: 0x22d3ee, p: [-3.5, 1.5, -2.5], i: 0.6 },
  { c: 0x60a5fa, p: [3.5, 1.5, -2.5], i: 0.55 },
  { c: 0xa78bfa, p: [0, 2, 0.5], i: 0.4 },
  { c: 0x34d399, p: [-3.5, 1.4, 2.2], i: 0.4 },
];
accents.forEach(({ c, p, i }) => {
  const l = new THREE.PointLight(c, i, 5, 2);
  l.position.set(...p);
  scene.add(l);
});

// ═══════════════════════════════════════════════
//  Room structure
// ═══════════════════════════════════════════════
const ROOM_W = 16;
const ROOM_D = 14;
const ROOM_H = 4;
/** Front-wall chalkboards + formula screen: only interact in the near third of the lab. */
const FRONT_WALL_DISPLAY_MAX_DIST = ROOM_D / 3;

// Floor — glossy tiles with glowing grid
const floor = rbox(ROOM_W, 0.14, ROOM_D, mat.floor, 0.02);
floor.position.y = -0.07;
floor.castShadow = false;
scene.add(floor);

// Raised platform center
const platform = rbox(5.5, 0.08, 4.2, mat.floorAccent, 0.04);
platform.position.set(0, 0.04, 0.3);
platform.castShadow = false;
scene.add(platform);
const platformEdge = rbox(5.55, 0.02, 4.25, mat.cyanGlow, 0.01);
platformEdge.position.set(0, 0.09, 0.3);
scene.add(platformEdge);

// Floor light strips (grid)
function addFloorStrip(len, x, z, rotY) {
  const strip = rbox(len, 0.012, 0.022, mat.cyanGlow, 0.004);
  strip.position.set(x, 0.015, z);
  strip.rotation.y = rotY;
  strip.castShadow = false;
  scene.add(strip);
}
for (let x = -7; x <= 7; x += 2) addFloorStrip(ROOM_D - 0.8, x, 0, Math.PI / 2);
for (let z = -6; z <= 6; z += 2) addFloorStrip(ROOM_W - 0.8, 0, z, 0);

// Walls
const wallT = 0.2;
const walls = [
  rbox(ROOM_W, ROOM_H, wallT, mat.wall, 0.01), // back
  rbox(ROOM_W, ROOM_H, wallT, mat.wall, 0.01), // front
  rbox(wallT, ROOM_H, ROOM_D, mat.wall, 0.01), // left
  rbox(wallT, ROOM_H, ROOM_D, mat.wall, 0.01), // right
];
walls[0].position.set(0, ROOM_H / 2, -ROOM_D / 2);
walls[1].position.set(0, ROOM_H / 2, ROOM_D / 2);
walls[2].position.set(-ROOM_W / 2, ROOM_H / 2, 0);
walls[3].position.set(ROOM_W / 2, ROOM_H / 2, 0);
walls.forEach((w) => {
  w.castShadow = false;
  scene.add(w);
});

// Ceiling
const ceiling = rbox(ROOM_W, 0.12, ROOM_D, mat.ceiling, 0.01);
ceiling.position.y = ROOM_H + 0.06;
ceiling.castShadow = false;
scene.add(ceiling);

// Matte side blackboards. Their vertical span matches the centre display,
// while their shorter horizontal length is preserved.
const sideBoardMat = new THREE.MeshStandardMaterial({
  color: 0x20364d,
  metalness: 0,
  roughness: 1,
});
const BLACKBOARD_COLORS = ['#f8fafc', '#67e8f9', '#fde047', '#fb7185'];
const BLACKBOARD_SIZES = [4, 9, 16];
const BLACKBOARD_SURFACE = '#20364d';
/** Shared brush state across both front-wall boards. mode: pen | eraser */
const blackboardBrush = {
  color: BLACKBOARD_COLORS[0],
  size: BLACKBOARD_SIZES[1],
  mode: 'pen',
};
const sideBlackboards = [];

// Toolbar layout (canvas px). Compact so pen / eraser / clear all fit.
const BB_COLOR_YS = [62, 118, 174, 230];
const BB_SIZE_YS = [330, 385, 440];
const BB_ERASER_Y = 548;
const BB_CLEAR_Y = 620;
const BB_TOOL_HIT_R = 28;
// Hand tracking can briefly place the cursor just outside a mesh edge even
// while the pinch itself is stable. Keep a narrow canvas-space margin so a
// continuous AR stroke does not get split by those one-frame misses.
const BB_AR_EDGE_TOLERANCE_PX = 18;
// Must also cover a temporarily slow camera / MediaPipe inference cadence.
const BB_STROKE_CONTINUITY_MS = 500;

function addSideBlackboard(x, toolbarSide, w = 3.6, h = 2.2) {
  const g = new THREE.Group();
  g.position.set(x, 2.45, -ROOM_D / 2 + 0.12);

  const board = rbox(w, h, 0.08, sideBoardMat, 0.02);
  g.add(board);

  const c = document.createElement('canvas');
  c.width = 1152;
  c.height = 704;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const toolbarW = 86;
  const toolbarX = toolbarSide === 'left' ? 0 : c.width - toolbarW;
  ctx.fillStyle = BLACKBOARD_SURFACE;
  ctx.fillRect(0, 0, c.width, c.height);

  function fillDrawingSurface() {
    ctx.fillStyle = BLACKBOARD_SURFACE;
    if (toolbarSide === 'left') {
      ctx.fillRect(toolbarW, 0, c.width - toolbarW, c.height);
    } else {
      ctx.fillRect(0, 0, c.width - toolbarW, c.height);
    }
  }

  function roundRectPath(x0, y0, rw, rh, r) {
    const rr = Math.min(r, rw / 2, rh / 2);
    ctx.beginPath();
    ctx.moveTo(x0 + rr, y0);
    ctx.arcTo(x0 + rw, y0, x0 + rw, y0 + rh, rr);
    ctx.arcTo(x0 + rw, y0 + rh, x0, y0 + rh, rr);
    ctx.arcTo(x0, y0 + rh, x0, y0, rr);
    ctx.arcTo(x0, y0, x0 + rw, y0, rr);
    ctx.closePath();
  }

  function drawToolbar() {
    ctx.save();
    ctx.fillStyle = '#122438';
    ctx.fillRect(toolbarX, 0, toolbarW, c.height);
    ctx.strokeStyle = '#4f6f8d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const dividerX = toolbarSide === 'left' ? toolbarW - 1 : toolbarX + 1;
    ctx.moveTo(dividerX, 0);
    ctx.lineTo(dividerX, c.height);
    ctx.stroke();

    const cx = toolbarX + toolbarW / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 20px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.fillStyle = '#b9d6ed';
    ctx.fillText('颜色', cx, 24);
    BLACKBOARD_COLORS.forEach((color, i) => {
      const cy = BB_COLOR_YS[i];
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (blackboardBrush.mode === 'pen' && blackboardBrush.color === color) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    });

    ctx.fillStyle = '#b9d6ed';
    ctx.fillText('粗细', cx, 290);
    BLACKBOARD_SIZES.forEach((size, i) => {
      const cy = BB_SIZE_YS[i];
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(4, size * 0.75), 0, Math.PI * 2);
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      if (blackboardBrush.size === size) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    });

    // ── Tools: eraser toggle + one-tap clear ──
    ctx.fillStyle = '#b9d6ed';
    ctx.fillText('工具', cx, 500);

    const toolW = toolbarW - 16;
    const toolH = 40;
    const toolX = toolbarX + 8;

    // Eraser
    const eraserOn = blackboardBrush.mode === 'eraser';
    roundRectPath(toolX, BB_ERASER_Y - toolH / 2, toolW, toolH, 8);
    ctx.fillStyle = eraserOn ? 'rgba(56, 189, 248, 0.28)' : 'rgba(15, 23, 42, 0.55)';
    ctx.fill();
    ctx.strokeStyle = eraserOn ? '#38bdf8' : '#64748b';
    ctx.lineWidth = eraserOn ? 2.5 : 1.5;
    ctx.stroke();
    // Mini eraser glyph
    ctx.save();
    ctx.translate(cx, BB_ERASER_Y - 6);
    ctx.rotate(-0.35);
    ctx.fillStyle = eraserOn ? '#e0f2fe' : '#cbd5e1';
    ctx.fillRect(-12, -5, 20, 11);
    ctx.fillStyle = eraserOn ? '#38bdf8' : '#94a3b8';
    ctx.fillRect(-12, 2, 20, 5);
    ctx.restore();
    ctx.font = '600 15px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.fillStyle = eraserOn ? '#e0f2fe' : '#cbd5e1';
    ctx.fillText('橡皮', cx, BB_ERASER_Y + 14);

    // Clear all
    roundRectPath(toolX, BB_CLEAR_Y - toolH / 2, toolW, toolH, 8);
    ctx.fillStyle = 'rgba(251, 113, 133, 0.18)';
    ctx.fill();
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.font = '600 16px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.fillStyle = '#fecdd3';
    ctx.fillText('清屏', cx, BB_CLEAR_Y);

    ctx.restore();
    tex.needsUpdate = true;
  }
  drawToolbar();

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
  );
  face.position.z = 0.041;
  g.add(face);

  // Only the root group is interactive. Child meshes (face/board) stay as pure
  // geometry so resolveInteractive walks up to this host, where pick/draw APIs live.
  // (Tagging children as interactive caused the mesh to be selected without APIs.)
  const markMeta = (o) => {
    o.userData.type = 'side_blackboard';
    o.userData.role = 'side_blackboard';
    o.userData.maxInteractDist = FRONT_WALL_DISPLAY_MAX_DIST;
  };
  markMeta(g);
  markMeta(face);
  markMeta(board);
  defineInteractionTarget(g, {
    kind: INTERACTION_KIND.SIDE_BLACKBOARD,
    role: 'side_blackboard',
    maxDistance: FRONT_WALL_DISPLAY_MAX_DIST,
  });

  function faceHitFromRay(rc) {
    face.updateMatrixWorld(true);
    return rc.intersectObject(face, false)[0] || null;
  }

  function drawingUvFromRay(rc) {
    const hit = faceHitFromRay(rc);
    if (hit?.uv) return { uv: hit.uv, distance: hit.distance };

    // Raycaster intersection is intentionally strict about the plane bounds.
    // For a held AR pinch, recover points that fall only a few texture pixels
    // beyond the edge, then clamp them to the drawable canvas. This avoids
    // breaking a stroke when MediaPipe jitters across the border by one frame.
    if (!rc?.ray) return null;
    const inverse = new THREE.Matrix4().copy(face.matrixWorld).invert();
    const localOrigin = rc.ray.origin.clone().applyMatrix4(inverse);
    const localDirection = rc.ray.direction.clone().transformDirection(inverse);
    if (Math.abs(localDirection.z) < 1e-5) return null;
    const rayT = -localOrigin.z / localDirection.z;
    if (!Number.isFinite(rayT) || rayT < 0) return null;
    const localX = localOrigin.x + localDirection.x * rayT;
    const localY = localOrigin.y + localDirection.y * rayT;
    const rawU = localX / w + 0.5;
    const rawV = localY / h + 0.5;
    const uMargin = BB_AR_EDGE_TOLERANCE_PX / c.width;
    const vMargin = BB_AR_EDGE_TOLERANCE_PX / c.height;
    if (rawU < -uMargin || rawU > 1 + uMargin || rawV < -vMargin || rawV > 1 + vMargin) {
      return null;
    }
    return {
      uv: new THREE.Vector2(
        THREE.MathUtils.clamp(rawU, 0, 1),
        THREE.MathUtils.clamp(rawV, 0, 1),
      ),
      distance: rayT,
    };
  }

  function pick(uv) {
    if (!uv) return null;
    const px = uv.x * c.width;
    const py = (1 - uv.y) * c.height;
    const inToolbar = toolbarSide === 'left' ? px <= toolbarW : px >= toolbarX;
    if (!inToolbar) return { action: 'draw', uv };

    for (let i = 0; i < BLACKBOARD_COLORS.length; i += 1) {
      if (Math.abs(py - BB_COLOR_YS[i]) <= BB_TOOL_HIT_R) {
        return { action: 'color', value: BLACKBOARD_COLORS[i] };
      }
    }
    for (let i = 0; i < BLACKBOARD_SIZES.length; i += 1) {
      if (Math.abs(py - BB_SIZE_YS[i]) <= BB_TOOL_HIT_R) {
        return { action: 'size', value: BLACKBOARD_SIZES[i] };
      }
    }
    if (Math.abs(py - BB_ERASER_Y) <= BB_TOOL_HIT_R) {
      return { action: 'eraser' };
    }
    if (Math.abs(py - BB_CLEAR_Y) <= BB_TOOL_HIT_R) {
      return { action: 'clear' };
    }
    return { action: 'toolbar' };
  }

  function canvasPoint(uv) {
    return { x: uv.x * c.width, y: (1 - uv.y) * c.height };
  }

  function clearBoard() {
    g.userData.stopStroke();
    fillDrawingSurface();
    drawToolbar();
    tex.needsUpdate = true;
  }

  g.userData.face = face;
  g.userData.maxInteractDist = FRONT_WALL_DISPLAY_MAX_DIST;
  g.userData.pickFromRay = (rc) => {
    const hit = faceHitFromRay(rc);
    if (!hit?.uv || hit.distance > FRONT_WALL_DISPLAY_MAX_DIST) return null;
    return pick(hit.uv);
  };
  g.userData.lastDrawPoint = null;
  g.userData.lastDrawAt = -Infinity;
  g.userData.stopStroke = () => {
    g.userData.lastDrawPoint = null;
    g.userData.lastDrawAt = -Infinity;
  };
  g.userData.clearBoard = clearBoard;
  g.userData.applyPick = (selection) => {
    if (selection?.action === 'color') {
      blackboardBrush.color = selection.value;
      blackboardBrush.mode = 'pen';
    } else if (selection?.action === 'size') {
      blackboardBrush.size = selection.value;
    } else if (selection?.action === 'eraser') {
      // Toggle eraser ↔ pen for quick switch while teaching.
      blackboardBrush.mode = blackboardBrush.mode === 'eraser' ? 'pen' : 'eraser';
    } else if (selection?.action === 'clear') {
      clearBoard();
      return false;
    } else {
      return selection?.action === 'draw';
    }
    sideBlackboards.forEach((item) => item.userData.drawToolbar());
    return false;
  };
  g.userData.drawFromRay = (rc) => {
    const hit = drawingUvFromRay(rc);
    if (!hit?.uv || hit.distance > FRONT_WALL_DISPLAY_MAX_DIST) {
      // A single missed AR frame should not sever a held stroke. A sustained
      // departure still ends it, so re-entering the board does not draw a line
      // across empty space.
      if (performance.now() - g.userData.lastDrawAt > BB_STROKE_CONTINUITY_MS) {
        g.userData.stopStroke();
      }
      return false;
    }
    const selection = pick(hit.uv);
    if (selection?.action !== 'draw') {
      g.userData.stopStroke();
      return false;
    }
    const p = canvasPoint(selection.uv);
    const now = performance.now();
    const prev = now - g.userData.lastDrawAt <= BB_STROKE_CONTINUITY_MS
      ? (g.userData.lastDrawPoint || p)
      : p;
    const erasing = blackboardBrush.mode === 'eraser';
    // Eraser is slightly broader than the pen at the same size setting.
    const lineW = erasing
      ? Math.max(12, blackboardBrush.size * 2.4)
      : blackboardBrush.size;
    ctx.save();
    ctx.strokeStyle = erasing ? BLACKBOARD_SURFACE : blackboardBrush.color;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
    g.userData.lastDrawPoint = p;
    g.userData.lastDrawAt = now;
    tex.needsUpdate = true;
    return true;
  };
  g.userData.drawToolbar = drawToolbar;

  sideBlackboards.push(g);
  scene.add(g);
  return g;
}
const centreBoardW = 4.55;
const centreBoardHalfW = centreBoardW / 2;
const sideBoardW = 3.6;
const sideBoardX = centreBoardHalfW + sideBoardW / 2;
addSideBlackboard(-sideBoardX, 'right', sideBoardW);
addSideBlackboard(sideBoardX, 'left', sideBoardW);

// ═══════════════════════════════════════════════
//  Futuristic lab tables
// ═══════════════════════════════════════════════
labLoader.setProgress(0.15, '装配实验台面…');
function makeTechTable(w, d, h = 0.88) {
  const g = new THREE.Group();
  // glossy white top
  const top = rbox(w, 0.05, d, mat.whiteGloss, 0.04);
  top.position.y = h;
  g.add(top);
  // glass underlayer glow
  const glowTop = rbox(w - 0.06, 0.015, d - 0.06, mat.cyanGlow, 0.01);
  glowTop.position.y = h - 0.03;
  g.add(glowTop);
  // slim carbon legs with feet
  const lx = w / 2 - 0.1, lz = d / 2 - 0.1;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = cyl(0.025, 0.035, h - 0.05, mat.carbon, 12);
      leg.position.set(sx * lx, (h - 0.05) / 2, sz * lz);
      g.add(leg);
      const foot = cyl(0.06, 0.06, 0.02, mat.chrome, 16);
      foot.position.set(sx * lx, 0.01, sz * lz);
      g.add(foot);
    }
  }
  return g;
}

// Four themed stations (center island stays general research console)
// layout: back-left 力学 | back-right 光学 | front-left 电磁学 | front-right 热力学
const tableLayouts = [
  { w: 3.4, d: 1.15, p: [-4.2, 0, -2.8], theme: '力学', color: '#0ea5e9' },
  { w: 3.4, d: 1.15, p: [4.2, 0, -2.8], theme: '光学', color: '#f59e0b' },
  { w: 2.8, d: 1.1, p: [-4.2, 0, 2.6], theme: '电磁学', color: '#ec4899' },
  { w: 2.8, d: 1.1, p: [4.2, 0, 2.6], theme: '热力学', color: '#f97316' },
];
tableLayouts.forEach(({ w, d, p }) => {
  const t = makeTechTable(w, d);
  t.position.set(...p);
  scene.add(t);
});


// Center island — holographic research console (unchanged role)
const island = makeTechTable(3.2, 1.6, 0.95);
island.position.set(0, 0, 0.4);
scene.add(island);

// Stools — modern
function makeStool() {
  const g = new THREE.Group();
  const seat = cyl(0.17, 0.17, 0.04, mat.whiteGloss, 24);
  seat.position.y = 0.58;
  g.add(seat);
  const ring = torus(0.15, 0.012, mat.cyanGlow, 8, 24);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.56;
  g.add(ring);
  const pole = cyl(0.022, 0.028, 0.5, mat.chrome, 12);
  pole.position.y = 0.3;
  g.add(pole);
  const base = cyl(0.18, 0.2, 0.03, mat.carbon, 20);
  base.position.y = 0.015;
  g.add(base);
  return g;
}
[
  // 力学台 / 光学台前
  [-4.2, -1.85], [-3.2, -1.85], [4.2, -1.85], [3.2, -1.85],
  // 电磁学台 / 热力学台前
  [-4.2, 3.5], [-3.4, 3.5], [4.2, 3.5], [3.4, 3.5],
  // 中央岛
  [-0.8, 1.55], [0.8, 1.55],
].forEach(([x, z]) => {
  const s = makeStool();
  s.position.set(x, 0, z);
  s.rotation.y = (Math.random() - 0.5) * 0.5;
  scene.add(s);
});

// ═══════════════════════════════════════════════
//  Animated equipment (Active Station Runtime)
//  Room animators always run; station animators only when that station is hot.
// ═══════════════════════════════════════════════
const roomAnimators = [];
/** @type {Record<string, Array<(t:number, dt?:number)=>void>>} */
const stationAnimators = Object.create(null);
/** @type {string|null} */
let registeringStationId = null;

// —— Experiment category stations ——

//  Place equipment by station theme
const TABLE_Y = 0.93;
const ISLAND_Y = 1.0;

const sharedProps = createSharedProps({ THREE, materials: mat, primitives });

const stationContext = {
  THREE,
  scene,
  camera,
  renderer,
  materials: mat,
  primitives,
  shared: sharedProps,
  registerAnimator: (animateStation, meta = {}) => {
    if (typeof animateStation !== 'function') return;
    const sid = meta.stationId || registeringStationId;
    if (sid) {
      if (!stationAnimators[sid]) stationAnimators[sid] = [];
      if (!stationAnimators[sid].includes(animateStation)) {
        stationAnimators[sid].push(animateStation);
      }
      return;
    }
    if (!roomAnimators.includes(animateStation)) {
      roomAnimators.push(animateStation);
    }
  },
  getExperimentState: () => expManager?.state ?? null,
  constants: { TABLE_Y, ISLAND_Y },
};

function createStationProxy(stationId) {
  const root = new THREE.Group();
  root.name = `${stationId}-station-proxy`;
  const hallBench = new THREE.Group();
  hallBench.userData.getHallTerminalTarget = () => null;
  const equipment = {
    stationId,
    setMode() {},
    suspend() {},
    shutdown() {},
    resume() {},
    update() {},
    updateState() {},
    mouseDrag: { movementX: 0, movementY: 0, shiftKey: false, holdLMB: false },
  };
  return { root, equipment, refs: { hallBench }, animators: [], proxy: true };
}

// Keep the first paint independent from station construction. In particular,
// the electro station owns several dense field-line and apparatus graphs; its
// factory must never run behind the boot loader. Menus and experiment intent
// call ensureStationLoaded() later, after the room is interactive.
const stationScenes = {};
for (const stationId of BOOT_STATION_IDS) {
  labLoader.setProgress(0.16 + (Object.keys(stationScenes).length * 0.03), `准备${stationId}实验台…`);
  const station = createStationProxy(stationId);
  stationScenes[stationId] = station;
  scene.add(station.root);
}
labLoader.setProgress(0.32, '实验室空间准备完成…');

// Active Station Runtime: at most one station contributes render/anim/raycast.
const stationPresence = createStationPresence({ stationScenes });

/** Legacy alias used by room decoration animators registered later. */
const animators = roomAnimators;

let hallBench = stationScenes.electro?.refs?.hallBench || null;

// Center island: chemistry apparatus in chem mode; otherwise empty research console.
sharedProps.animators.forEach(stationContext.registerAnimator);

// ═══════════════════════════════════════════════
//  Interactive wall display — formula & concept board
// ═══════════════════════════════════════════════
function makeInteractiveFormulaBoard() {
  const g = new THREE.Group();
  const boardW = 4.4;
  const boardH = 2.05;
  const c = document.createElement('canvas');
  // Higher resolution for large wall fonts / crisp UI
  c.width = 1920;
  c.height = 900;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const state = {
    isStandby: true,
    category: 'all',
    activeStationId: 'mechanics',
    stationId: null,
    selectedId: null,
    page: 0,
  };
  let hitRegions = [];

  function redraw() {
    const result = drawFormulaBoard(ctx, c.width, c.height, state);
    hitRegions = result.hits || [];
    tex.needsUpdate = true;
  }
  redraw();

  const screenMat = new THREE.MeshStandardMaterial({
    map: tex,
    metalness: 0.15,
    roughness: 0.35,
    emissive: 0x0c4a6e,
    emissiveIntensity: 0.1,
  });
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(boardW, boardH),
    screenMat,
  );
  screen.position.z = 0.02;
  g.add(screen);

  // back plate
  const plate = rbox(boardW + 0.08, boardH + 0.08, 0.05, mat.carbon, 0.02);
  plate.position.z = -0.01;
  g.add(plate);

  // invisible hit volume (slightly larger for easier aiming)
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(boardW + 0.15, boardH + 0.15, 0.2),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.z = 0.05;
  g.add(hit);

  const tag = (o) => {
    o.userData.type = 'formula_board';
    o.userData.role = 'formula_board';
    // Only interact within ~1/3 of lab depth to avoid accidental activation from afar
    o.userData.maxInteractDist = FRONT_WALL_DISPLAY_MAX_DIST;
  };
  tag(g);
  tag(screen);
  tag(hit);
  tag(plate);
  defineInteractionTarget(g, {
    kind: INTERACTION_KIND.FORMULA_BOARD,
    role: 'formula_board',
    maxDistance: FRONT_WALL_DISPLAY_MAX_DIST,
  });

  g.userData.screen = screen;
  g.userData.state = state;
  g.userData.redraw = redraw;
  g.userData.maxInteractDist = FRONT_WALL_DISPLAY_MAX_DIST;

  g.userData.pickFromRay = (rc) => {
    if (!g.visible || state.isStandby) return null;
    screen.updateMatrixWorld(true);
    const hs = rc.intersectObject(screen, false);
    if (!hs.length || !hs[0].uv) return null;
    // Distance gate: board only responds in the front third of the lab
    if (hs[0].distance > FRONT_WALL_DISPLAY_MAX_DIST) return null;
    return pickFormulaBoard(hs[0].uv.x, hs[0].uv.y, c.width, c.height, hitRegions);
  };

  g.userData.applyPick = (pick) => {
    if (!pick?.action) return false;
    if (pick.action === 'home') {
      state.stationId = null;
      state.selectedId = null;
      redraw();
      showToast('返回实验室大厅');
      return true;
    }
    if (pick.action === 'station' && pick.stationId) {
      state.stationId = pick.stationId;
      state.activeStationId = pick.stationId;
      state.selectedId = null;
      redraw();
      const st = FORMULA_CATALOG.stations.find((s) => s.id === pick.stationId);
      showToast(`进入：${st?.name || pick.stationId}`);
      return true;
    }
    if (pick.action === 'select' && pick.itemId) {
      state.selectedId = pick.itemId;
      redraw();
      const item = FORMULA_CATALOG.items.find((it) => it.id === pick.itemId);
      showToast(item ? `实验：${item.expName}` : '已打开实验详情');
      return true;
    }
    if (pick.action === 'nav' && pick.itemId) {
      state.selectedId = pick.itemId;
      redraw();
      const item = FORMULA_CATALOG.items.find((it) => it.id === pick.itemId);
      showToast(item ? `实验：${item.expName}` : '切换实验');
      return true;
    }
    if (pick.action === 'back') {
      if (state.selectedId) {
        state.selectedId = null;
        redraw();
        showToast('返回实验列表');
      } else {
        state.stationId = null;
        redraw();
        showToast('返回实验室大厅');
      }
      return true;
    }
    if (pick.action === 'category' && pick.categoryId) {
      if (pick.categoryId === 'all') {
        state.stationId = null;
        state.selectedId = null;
      } else {
        state.stationId = pick.categoryId;
        state.selectedId = null;
      }
      redraw();
      return true;
    }
    return false;
  };

  g.userData.syncExperiment = (expId, stationId) => {
    if (!expId) {
      if (state.selectedId || (stationId && state.stationId !== stationId)) {
        state.stationId = stationId || null;
        state.selectedId = null;
        redraw();
      }
      return;
    }
    const item = FORMULA_CATALOG.items.find((it) => it.expId === expId || it.id === expId);
    if (item) {
      if (state.selectedId !== item.id || state.stationId !== item.cat) {
        state.selectedId = item.id;
        state.stationId = item.cat;
        redraw();
      }
    } else if (stationId) {
      if (state.stationId !== stationId || state.selectedId !== null) {
        state.stationId = stationId;
        state.selectedId = null;
        redraw();
      }
    }
  };

  // gentle idle emissive pulse
  animators.push((t) => {
    if (g.visible) {
      screenMat.emissiveIntensity = state.isStandby
        ? 0.04 + 0.02 * Math.sin(t * 0.8)
        : 0.08 + 0.04 * Math.sin(t * 1.2);
    }
  });

  return g;
}

const formulaBoard = makeInteractiveFormulaBoard();
formulaBoard.position.set(0, 2.45, -ROOM_D / 2 + 0.14);
scene.add(formulaBoard);

// frame glow (保持存在，走近增强)
const boardFrame = rbox(4.55, 2.2, 0.04, mat.cyanGlow, 0.02);
boardFrame.position.set(0, 2.45, -ROOM_D / 2 + 0.1);
scene.add(boardFrame);

const boardLight = new THREE.PointLight(0xbae6fd, 0.8, 6, 1.2);
boardLight.position.set(0, 2.45, -ROOM_D / 2 + 0.4);
scene.add(boardLight);

// 大屏内容走近激活机制：默认显示高科技待机屏，走近前 1/3 区域 (FRONT_WALL_DISPLAY_MAX_DIST) 才唤醒四大板块控制台
animators.push(() => {
  if (!camera) return;
  const dist = camera.position.distanceTo(formulaBoard.position);
  const isNear = dist <= FRONT_WALL_DISPLAY_MAX_DIST;
  const shouldBeStandby = !isNear;
  const boardState = formulaBoard?.userData?.state;
  if (boardState && boardState.isStandby !== shouldBeStandby) {
    boardState.isStandby = shouldBeStandby;
    formulaBoard.userData.redraw?.();
    boardLight.intensity = isNear ? 3.2 : 0.8;
  }
});

// ═══════════════════════════════════════════════
//  Side wall holographic posters
// ═══════════════════════════════════════════════
function makeTechPoster(title, subtitle, accent, x, z, rotY) {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 480;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 320, 480);
  g.addColorStop(0, '#f0f9ff');
  g.addColorStop(1, '#e0f2fe');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 320, 480);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, 296, 456);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.15;
  ctx.fillRect(12, 12, 296, 60);
  ctx.globalAlpha = 1;
  ctx.font = 'bold 26px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 160, 52);
  ctx.fillStyle = '#64748b';
  ctx.font = '14px sans-serif';
  ctx.fillText(subtitle, 160, 90);

  // abstract tech diagram
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(160, 240, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(160, 240, 45, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(160 + Math.cos(a) * 45, 240 + Math.sin(a) * 45);
    ctx.lineTo(160 + Math.cos(a) * 70, 240 + Math.sin(a) * 70);
    ctx.stroke();
  }
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(160, 240, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px monospace';
  ctx.fillText('MODULE  ·  ACTIVE', 160, 420);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = rbox(0.85, 1.25, 0.03, new THREE.MeshStandardMaterial({
    map: tex, metalness: 0.15, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.05,
  }), 0.02);
  mesh.position.set(x, 2.0, z);
  mesh.rotation.y = rotY;
  scene.add(mesh);
  // LED strip under poster
  const strip = rbox(0.7, 0.015, 0.02, mat.cyanGlow, 0.005);
  strip.position.set(x + Math.sin(rotY) * 0.02, 1.32, z + Math.cos(rotY) * 0.02);
  strip.rotation.y = rotY;
  scene.add(strip);
}

// side-wall tech posters removed — replaced by physicist portrait gallery

// ═══════════════════════════════════════════════
//  Server racks / equipment columns
// ═══════════════════════════════════════════════
function makeServerRack() {
  const g = new THREE.Group();
  const body = rbox(0.55, 1.9, 0.45, mat.whiteGloss, 0.03);
  body.position.y = 0.95;
  g.add(body);
  for (let i = 0; i < 8; i++) {
    const slot = rbox(0.48, 0.12, 0.02, mat.carbon, 0.01);
    slot.position.set(0, 0.3 + i * 0.2, 0.22);
    g.add(slot);
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x6ee7b7, emissive: 0x10b981, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.35,
    });
    const led = sphere(0.012, ledMat, 8);
    led.position.set(0.18, 0.3 + i * 0.2, 0.24);
    g.add(led);
    const phase = i * 1.7;
    animators.push((t) => {
      ledMat.emissiveIntensity = 0.35 + 0.75 * (0.5 + 0.5 * Math.sin(t * 3 + phase));
    });
  }
  const topBar = rbox(0.5, 0.03, 0.4, mat.cyanGlow, 0.01);
  topBar.position.y = 1.92;
  g.add(topBar);
  return g;
}
const rack1 = makeServerRack();
rack1.position.set(-ROOM_W / 2 + 0.5, 0, 5.2);
scene.add(rack1);
const rack2 = makeServerRack();
rack2.position.set(ROOM_W / 2 - 0.5, 0, 5.2);
scene.add(rack2);

// Sliding door
const door = rbox(1.3, 2.4, 0.08, mat.darkGlass, 0.03);
door.position.set(ROOM_W / 2 - 2.2, 1.2, ROOM_D / 2 - 0.08);
scene.add(door);
const doorFrame = rbox(1.45, 2.55, 0.05, mat.chrome, 0.02);
doorFrame.position.set(ROOM_W / 2 - 2.2, 1.2, ROOM_D / 2 - 0.12);
scene.add(doorFrame);
const doorLed = rbox(1.35, 0.02, 0.03, mat.cyanGlow, 0.005);
doorLed.position.set(ROOM_W / 2 - 2.2, 2.45, ROOM_D / 2 - 0.05);
scene.add(doorLed);

// ═══════════════════════════════════════════════
//  Portrait frames — famous physicists (local assets)
// ═══════════════════════════════════════════════
labLoader.setProgress(0.32, '加载科学家肖像…');

const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
const portraitFrames = [];

/** @returns {Promise<THREE.Texture | null>} */
function loadPortraitTexture(url) {
  return new Promise((resolve) => {
    const urls = [url.replace(/\.jpe?g$/i, '.webp'), url];
    let attempt = 0;
    const load = () => {
    textureLoader.load(
      urls[attempt],
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        resolve(tex);
      },
      undefined,
      () => {
        attempt += 1;
        if (attempt < urls.length) load();
        else resolve(null);
      },
    );
    };
    load();
  });
}

function makeNameplate(name, years) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#67e8f9';
  ctx.fillRect(0, 0, 512, 3);
  ctx.fillStyle = '#f8fafc';
  // Chinese names need slightly smaller type to fit long strings
  ctx.font = name.length > 6
    ? 'bold 26px "Microsoft YaHei", "Segoe UI", sans-serif'
    : 'bold 30px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, 256, 42);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '22px "Segoe UI", sans-serif';
  ctx.fillText(years, 256, 74);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePortraitFrame(imageUrl, name, years, w = 0.72, h = 0.92) {
  const g = new THREE.Group();
  const frameDepth = 0.04;
  const border = 0.045;

  // outer metallic frame
  const outer = rbox(w + border * 2, h + border * 2 + 0.12, frameDepth, mat.chrome, 0.015);
  outer.position.z = -frameDepth / 2;
  g.add(outer);

  // inner dark mat
  const matte = rbox(w + border * 0.7, h + border * 0.7, 0.012, mat.carbon, 0.008);
  matte.position.z = 0.002;
  g.add(matte);

  // portrait plane
  const photoMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc, metalness: 0.05, roughness: 0.45,
  });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(w, h), photoMat);
  photo.position.z = 0.012;
  g.add(photo);

  let portraitPromise = null;
  g.userData.loadPortrait = () => {
    if (portraitPromise) return portraitPromise;
    g.userData.portraitLoading = true;
    portraitPromise = loadPortraitTexture(imageUrl).then((tex) => {
      if (tex) {
        photoMat.map = tex;
        photoMat.color.set(0xffffff);
        photoMat.needsUpdate = true;
      } else {
        photoMat.color.set(0x94a3b8);
        photoMat.emissive = new THREE.Color(0x1e293b);
        photoMat.emissiveIntensity = 0.2;
      }
      g.userData.portraitLoaded = true;
    }).finally(() => {
      g.userData.portraitLoading = false;
    });
    return portraitPromise;
  };

  // glass cover
  const cover = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.01, h + 0.01),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.05, clearcoat: 1.0,
      clearcoatRoughness: 0.1, transparent: true, opacity: 0.15, side: THREE.DoubleSide,
    })
  );
  cover.position.z = 0.02;
  g.add(cover);

  // nameplate under portrait
  const plateW = w + border * 1.6;
  const plate = rbox(plateW, 0.1, 0.02, mat.carbon, 0.01);
  plate.position.set(0, -(h / 2 + border + 0.02), 0.01);
  g.add(plate);
  const nameTex = makeNameplate(name, years);
  const nameMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(plateW * 0.95, 0.085),
    new THREE.MeshStandardMaterial({ map: nameTex, metalness: 0.1, roughness: 0.5 })
  );
  nameMesh.position.set(0, -(h / 2 + border + 0.02), 0.022);
  g.add(nameMesh);

  // subtle LED edge under frame
  const led = rbox(w + border * 2, 0.012, 0.012, mat.cyanGlow, 0.003);
  led.position.set(0, -(h / 2 + border + 0.08), 0.01);
  g.add(led);

  portraitFrames.push(g);

  return g;
}

// left wall portraits
const portraitsLeft = [
  { file: 'einstein.jpg', name: '阿尔伯特·爱因斯坦', years: '1879 – 1955', z: -3.8 },
  { file: 'newton.jpg', name: '艾萨克·牛顿', years: '1643 – 1727', z: -1.6 },
  { file: 'curie.jpg', name: '玛丽·居里', years: '1867 – 1934', z: 0.6 },
  { file: 'galileo.jpg', name: '伽利略·伽利莱', years: '1564 – 1642', z: 2.8 },
];
portraitsLeft.forEach(({ file, name, years, z }) => {
  const f = makePortraitFrame(`assets/portraits/${file}`, name, years);
  f.position.set(-ROOM_W / 2 + 0.14, 1.85, z);
  f.rotation.y = Math.PI / 2;
  scene.add(f);
});

// right wall portraits
const portraitsRight = [
  { file: 'maxwell.jpg', name: '詹姆斯·麦克斯韦', years: '1831 – 1879', z: -3.8 },
  { file: 'faraday.jpg', name: '迈克尔·法拉第', years: '1791 – 1867', z: -1.6 },
  { file: 'tesla.jpg', name: '尼古拉·特斯拉', years: '1856 – 1943', z: 0.6 },
  { file: 'planck.jpg', name: '马克斯·普朗克', years: '1858 – 1947', z: 2.8 },
];
portraitsRight.forEach(({ file, name, years, z }) => {
  const f = makePortraitFrame(`assets/portraits/${file}`, name, years);
  f.position.set(ROOM_W / 2 - 0.14, 1.85, z);
  f.rotation.y = -Math.PI / 2;
  scene.add(f);
});

// Portraits are a small, fixed local gallery. Start every request as soon as
// the room graph exists so a scientist's image never pops in only after the
// learner approaches that wall. Do not await this: room interaction and first
// frame remain independent from image decoding/upload.
const portraitPreloadPromise = Promise.all(
  portraitFrames.map((frame) => frame.userData.loadPortrait?.()),
);
portraitPreloadPromise.catch(() => { /* individual loaders fall back to a neutral frame */ });


// ═══════════════════════════════════════════════
//  Holo projectors — volumetric double-sided holograms
//  · Front & back both readable / interactive
//  · Soft-face the player; switch primary side by camera side
// ═══════════════════════════════════════════════
labLoader.setProgress(0.40, '同步全息终端…');

const STATION_LABEL = {
  mechanics: '力学实验台',
  optics: '光学实验台',
  electro: '电磁学实验台',
  thermo: '热力学实验台',
};
const STATION_EN = {
  mechanics: 'MECHANICS',
  optics: 'OPTICS',
  electro: 'ELECTRO',
  thermo: 'THERMO',
};

/** Shared temps for holo billboard / side tests (avoid GC in animate) */
const _holoWorldPos = new THREE.Vector3();
const _holoCamDir = new THREE.Vector3();
const _holoFront = new THREE.Vector3();
const _holoParentQuat = new THREE.Quaternion();
const _holoParentEuler = new THREE.Euler();

function makeHoloPanel(stationId, title, accentHex, accentNum = 0x38bdf8) {
  const g = new THREE.Group();
  // 4:3 balanced tactical holographic screen (1.36m x 1.02m)
  const panelW = 1.36;
  const panelH = 1.02;
  const fullTitle = STATION_LABEL[stationId] || title;
  const enTitle = STATION_EN[stationId] || 'STATION';

  // ── Projector pedestal on tabletop (Sleek High-Tech Base) ──
  const pedestalG = new THREE.Group();
  g.add(pedestalG);

  // 1. Smooth 64-segment Chamfered Base Chassis (Dark Titanium/Carbon)
  const base = cyl(0.185, 0.20, 0.018, mat.carbon, 64);
  base.position.y = 0.009;
  pedestalG.add(base);

  // 2. Embedded Luminous LED Accent Ring
  const ledMat = new THREE.MeshStandardMaterial({
    color: accentNum,
    emissive: accentNum,
    emissiveIntensity: 1.2,
    metalness: 0.2,
    roughness: 0.3,
  });
  const ledRing = torus(0.165, 0.0035, ledMat, 8, 64);
  ledRing.rotation.x = Math.PI / 2;
  ledRing.position.y = 0.019;
  pedestalG.add(ledRing);

  // 3. Precision Anodized Alloy Stepped Collar
  const plate = cyl(0.125, 0.138, 0.014, mat.silver, 48);
  plate.position.y = 0.024;
  pedestalG.add(plate);

  const ring = torus(0.125, 0.003, mat.chrome, 8, 48);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.031;
  pedestalG.add(ring);

  // 4. Mirror Chrome Optical Emitter Nozzle & Dark Glass Well
  const emitter = cyl(0.075, 0.060, 0.018, mat.chrome, 32);
  emitter.position.y = 0.038;
  pedestalG.add(emitter);

  const innerWell = cyl(0.055, 0.055, 0.004, mat.darkGlass, 32);
  innerWell.position.y = 0.044;
  pedestalG.add(innerWell);

  // 5. Central Glowing Energy Core
  const coreMat = new THREE.MeshStandardMaterial({
    color: accentNum,
    emissive: accentNum,
    emissiveIntensity: 1.35,
    metalness: 0.15,
    roughness: 0.28,
    transparent: true,
    opacity: 0.95,
  });
  const core = sphere(0.024, coreMat, 32);
  core.position.y = 0.068;
  pedestalG.add(core);

  // ── Volumetric Hologram Light Field (Dynamic Expanding Holographic Wavefield) ──
  // Volumetric beam cone (tip into emitter)
  const coneMat = new THREE.MeshBasicMaterial({
    color: accentNum,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.72, 32, 1, true), coneMat);
  cone.position.y = 0.46;
  cone.rotation.x = Math.PI;
  g.add(cone);

  // Inner beam core
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.06,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.080, 0.62, 16, 1, true), beamMat);
  beam.position.y = 0.41;
  g.add(beam);

  // Dynamic upward expanding & diffusing harmonic wave pulse rings
  const waveRings = [];
  for (let i = 0; i < 4; i++) {
    const rm = new THREE.MeshBasicMaterial({
      color: accentNum,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const wr = torus(0.1, 0.0018, rm, 4, 48);
    wr.rotation.x = Math.PI / 2;
    g.add(wr);
    waveRings.push({ mesh: wr, mat: rm, phase: i / 4 });
  }

  // ── Floating hologram group (yaw tracks player) ──
  const floatG = new THREE.Group();
  const FLOAT_Y_NORMAL = 0.84;
  floatG.position.set(0, FLOAT_Y_NORMAL, 0);
  g.add(floatG);

  // ── Canvas UI (full interactive screen on hologram) ──
  let c = document.createElement('canvas');
  c.width = 960;
  c.height = 720;
  let ctx = c.getContext('2d');
  let lastDrawKey = '';
  let hitRegions = [];
  let boundHud = null;
  let boundDataHtml = '';

  // ── Proximity & Deployment State (Default dormant until player approaches table) ──
  let currentReveal = 0.0;
  const PROXIMITY_DIST = 3.6; // meters: activates when player approaches the bench

  g.userData.maximized = false;
  g.userData._floatBaseY = FLOAT_Y_NORMAL;
  g.userData._screenSx = 1.0;
  g.userData._screenSy = 1.0;
  g.userData.revealProgress = 0.0;
  g.userData.accentHex = accentHex;
  g.userData.fullTitle = fullTitle;
  g.userData.enTitle = enTitle;

  // Default dormant: hidden until learner is near the table
  floatG.visible = false;
  cone.visible = false;
  beam.visible = false;
  waveRings.forEach((r) => { r.mesh.visible = false; });

  const createScreenTexture = () => {
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return texture;
  };
  let tex = createScreenTexture();

  // Front + back planes (back rotated so text is not mirrored)
  const makeFaceMat = () => new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.0,
    side: THREE.FrontSide,
    depthWrite: false,
    toneMapped: false,
  });
  const frontMat = makeFaceMat();
  const backMat = makeFaceMat();

  const front = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), frontMat);
  front.position.z = 0.008;
  front.renderOrder = 1;
  floatG.add(front);

  const backFace = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), backMat);
  backFace.rotation.y = Math.PI; // correct text orientation from behind
  backFace.position.z = -0.008;
  backFace.visible = false;
  backFace.renderOrder = 1;
  floatG.add(backFace);

  // Dedicated pick targets (have UVs — unlike the broad hit box)
  g.userData.screenFaces = [front, backFace];

  const holoLight = new THREE.PointLight(accentNum, 0, 3.2, 2);
  holoLight.position.set(0, 0.65, 0);
  g.add(holoLight);

  // Thick hit volume — both sides of the projection
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(panelW + 0.25, panelH + 0.45, 0.55),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.set(0, FLOAT_Y_NORMAL, 0);
  g.add(hit);

  // Tabletop terminal is selector-only: activate + choose experiment.
  const HOLO_SURFACE = 'selector';

  const syncScreenLayout = (active) => {
    const layout = getHoloScreenLayoutSize({
      active: !!active,
      hud: active ? boundHud : null,
      dataHtml: boundDataHtml,
      surface: HOLO_SURFACE,
    });
    if (layout.width === c.width && layout.height === c.height) return false;

    const nextCanvas = document.createElement('canvas');
    nextCanvas.width = layout.width;
    nextCanvas.height = layout.height;
    c = nextCanvas;
    ctx = c.getContext('2d');
    const previousTexture = tex;
    tex = createScreenTexture();
    frontMat.map = tex;
    backMat.map = tex;
    frontMat.needsUpdate = true;
    backMat.needsUpdate = true;
    g.userData.tex = tex;
    previousTexture.dispose();
    const sx = layout.width / 960;
    const sy = layout.height / 720;
    g.userData._screenSx = sx;
    g.userData._screenSy = sy;
    g.userData._floatBaseY = FLOAT_Y_NORMAL + (panelH * (sy - 1)) / 2;
    g.userData.canvasW = layout.width;
    g.userData.canvasH = layout.height;
    g.userData.screenWorldSize = { width: panelW * sx, height: panelH * sy };
    return true;
  };

  const draw = (active, force = false) => {
    const layoutChanged = syncScreenLayout(active);
    const rev = boundHud?._rev ?? 0;
    const maxed = g.userData.maximized ? 1 : 0;
    const pressedKey = g.userData._pressedHitId || '';
    const key = `${active ? 1 : 0}|${maxed}|${rev}|${pressedKey}|${boundHud?.expId || ''}|${boundHud?.stepIndex ?? ''}|${boundHud?.running ? 1 : 0}|${c.width}x${c.height}|${boundDataHtml.slice(0, 48)}`;
    if (!force && !layoutChanged && key === lastDrawKey) return;
    lastDrawKey = key;

    const W = c.width;
    const H = c.height;
    const result = drawHoloScreen(ctx, W, H, {
      accentHex,
      fullTitle,
      enTitle,
      active: !!active,
      hud: active ? boundHud : null,
      dataHtml: boundDataHtml,
      maximized: !!g.userData.maximized,
      surface: HOLO_SURFACE,
      pressedPick: g.userData._pressedHit || null,
    });
    hitRegions = result.hits || [];
    g.userData.hitRegions = hitRegions;
    g.userData.boundHud = boundHud;
    g.userData.boundDataHtml = boundDataHtml;
    tex.needsUpdate = true;
  };

  draw(false);

  const tag = (o) => {
    o.userData.type = 'holo';
    o.userData.role = 'holo_selector';
    o.userData.stationId = stationId;
    o.userData.interactive = true;
  };
  tag(g);
  tag(hit);
  tag(front);
  tag(backFace);
  tag(base);
  tag(core);
  defineInteractionTarget(g, {
    kind: INTERACTION_KIND.HOLO_SELECTOR,
    role: 'holo_selector',
    stationId,
  });

  g.userData.draw = draw;
  g.userData.tex = tex;
  g.userData.frontMat = frontMat;
  g.userData.backMat = backMat;
  g.userData.floatG = floatG;
  g.userData.screenRoot = floatG;
  g.userData.holoLight = holoLight;
  g.userData.coreMat = coreMat;
  g.userData.facingSide = 1; // +1 front primary, -1 back primary
  g.userData.canvasW = c.width;
  g.userData.canvasH = c.height;
  g.userData.setHud = (hud, dataHtml = '') => {
    boundHud = hud;
    boundDataHtml = dataHtml || '';
    // Draw is invoked only from budget jobs (pushHudToHoloScreens schedules us).
    // Still paint here so a direct setHud call works, but prefer callers that
    // already sit on the frame budget.
    draw(!!g.userData.active, false);
  };
  g.userData.setMaximized = (on) => {
    // Fullscreen is managed globally. Never force a dense redraw here —
    // closing the big screen used to hitch by repainting the whole HUD twice.
    if (g.userData.maximized === !!on) return;
    g.userData.maximized = !!on;
    lastDrawKey = '';
  };
  /** UV pick on hologram screen (like clicking a monitor) */
  g.userData.pick = (uv) => {
    if (!uv) return null;
    // Idle terminal: whole panel is the power-on target (matches on-screen CTA).
    if (!g.userData.active) {
      return {
        action: 'activate',
        role: 'holo_activate',
        stationId,
        x: 0,
        y: 0,
        w: c.width,
        h: c.height,
      };
    }
    return pickHoloScreen(uv.x, uv.y, c.width, c.height, hitRegions, 1);
  };
  const _pickPlane = new THREE.Plane();
  const _pickHit = new THREE.Vector3();
  const _pickLocal = new THREE.Vector3();
  const _pickN = new THREE.Vector3();

  /**
   * Infinite-plane UV for a screen face (works even if ray barely misses mesh edges).
   * u,v in 0..1 relative to unscaled PlaneGeometry bounds; outside clamped.
   */
  function uvOnFacePlane(raycaster, face) {
    face.updateMatrixWorld(true);
    _pickN.set(0, 0, 1).transformDirection(face.matrixWorld).normalize();
    face.getWorldPosition(_holoWorldPos);
    _pickPlane.setFromNormalAndCoplanarPoint(_pickN, _holoWorldPos);
    const ray = raycaster.ray;
    if (!ray.intersectPlane(_pickPlane, _pickHit)) return null;
    // must be in front of camera
    _pickLocal.subVectors(_pickHit, ray.origin);
    if (_pickLocal.dot(ray.direction) < 1e-4) return null;

    _pickLocal.copy(_pickHit);
    face.worldToLocal(_pickLocal);
    // PlaneGeometry: x ∈ [-w/2,w/2], y ∈ [-h/2,h/2] (scale already undone by worldToLocal)
    const u = (_pickLocal.x / panelW) + 0.5;
    const v = (_pickLocal.y / panelH) + 0.5;
    if (u < -0.08 || u > 1.08 || v < -0.08 || v > 1.08) return null;
    return {
      u: THREE.MathUtils.clamp(u, 0, 1),
      v: THREE.MathUtils.clamp(v, 0, 1),
      distance: ray.origin.distanceTo(_pickHit),
    };
  }

  /**
   * Collect UV samples on both screen faces. Plane tests ignore other meshes, so
   * table instruments in front of the wall-side projector do not block aim.
   */
  function collectScreenSamples(raycaster) {
    floatG.updateMatrixWorld(true);
    front.updateMatrixWorld(true);
    backFace.updateMatrixWorld(true);

    const samples = [];
    for (const face of [front, backFace]) {
      const uvInfo = uvFromRayAndMesh(raycaster, face) || uvOnFacePlane(raycaster, face);
      if (!uvInfo) continue;
      samples.push({ face, ...uvInfo });
    }
    samples.sort((a, b) => a.distance - b.distance);
    return samples;
  }

  /** Closest screen-plane aim (active or idle) — used to prefer holo over gear. */
  g.userData.screenAimFromRay = (raycaster) => {
    const samples = collectScreenSamples(raycaster);
    return samples[0] || null;
  };

  /**
   * Raycast screen planes for UV. Prefer the closer face; try both if needed.
   * Ensures matrixWorld is current (important after maximize scale / float bob).
   */
  g.userData.pickFromRay = (raycaster) => {
    // Only accept picks when hologram screen has deployed
    if (currentReveal < 0.25) return null;

    const samples = collectScreenSamples(raycaster);
    if (!samples.length) return null;
    // Idle tabletop terminal: any screen-plane hit powers on the experiment menu.
    if (!g.userData.active) {
      return {
        action: 'activate',
        role: 'holo_activate',
        stationId,
        x: 0,
        y: 0,
        w: c.width,
        h: c.height,
      };
    }

    for (const s of samples) {
      const side = s.face === backFace ? -1 : 1;
      const pick = pickHoloScreen(s.u, s.v, c.width, c.height, hitRegions, side);
      if (pick) return pick;
    }
    const s0 = samples[0];
    return pickHoloScreen(s0.u, s0.v, c.width, c.height, hitRegions, s0.face === backFace ? -1 : 1);
  };

  // Billboard yaw + proximity deployment + bottom-to-top rising reveal
  animators.push((t) => {
    // 1. Proximity Check: only deploy when player approaches the bench or station is actively open
    g.getWorldPosition(_holoWorldPos);
    const camDist = Math.hypot(camera.position.x - _holoWorldPos.x, camera.position.z - _holoWorldPos.z);
    const isNear = camDist < PROXIMITY_DIST || !!g.userData.active;
    const targetReveal = isNear ? 1.0 : 0.0;

    // Smooth deployment lerp (takes ~0.9s to deploy from bottom to top with high-tech feel)
    currentReveal += (targetReveal - currentReveal) * 0.06;
    if (currentReveal < 0.002) currentReveal = 0.0;
    if (currentReveal > 0.998) currentReveal = 1.0;
    g.userData.revealProgress = currentReveal;

    if (currentReveal <= 0.0001) {
      floatG.visible = false;
      cone.visible = false;
      beam.visible = false;
      waveRings.forEach((r) => { r.mesh.visible = false; });
      holoLight.intensity = 0;
      // Soft standby breathing on the pedestal
      const idlePulse = Math.sin(t * 1.8);
      coreMat.emissiveIntensity = 0.35 + 0.12 * idlePulse;
      ledMat.emissiveIntensity = 0.35 + 0.12 * idlePulse;
      return;
    }

    floatG.visible = true;
    cone.visible = true;
    beam.visible = true;
    waveRings.forEach((r) => { r.mesh.visible = true; });

    // Smoothstep / S-curve ease for cinematic deployment
    const ease = currentReveal * currentReveal * (3 - 2 * currentReveal);

    const phase = t + stationId.length * 0.7;
    const targetBaseY = g.userData._floatBaseY ?? FLOAT_Y_NORMAL;
    // Rises from optical well (0.10m) up to floating height (0.78m)
    const deployedY = 0.10 + (targetBaseY - 0.10) * ease;
    floatG.position.y = deployedY + Math.sin(phase * 1.35) * (0.022 * ease);
    hit.position.y = floatG.position.y;

    // Scale screen from bottom to top as it emerges
    const sx = g.userData._screenSx ?? 1.0;
    const sy = g.userData._screenSy ?? 1.0;
    const currentSx = sx * (0.2 + 0.8 * ease);
    const currentSy = sy * ease;
    front.scale.set(currentSx, currentSy, 1);
    backFace.scale.set(currentSx, currentSy, 1);
    hit.scale.set(currentSx, currentSy, 1);

    // Anchor expansion to the bottom edge so it physically rises/wipes upwards
    const bottomShiftY = -panelH * sy * (1 - ease) * 0.5;
    front.position.y = bottomShiftY;
    backFace.position.y = bottomShiftY;

    // High-tech holographic opacity fade
    frontMat.opacity = ease;
    backMat.opacity = ease;

    // Volumetric cone & beam expansion
    cone.scale.set(ease, ease, ease);
    cone.position.y = 0.08 + (0.46 - 0.08) * ease;
    coneMat.opacity = (0.06 + 0.025 * Math.sin(t * 2.1)) * ease * (g.userData.active ? 1.2 : 0.9);

    beam.scale.set(ease, ease, ease);
    beam.position.y = 0.06 + (0.41 - 0.06) * ease;
    beamMat.opacity = (0.05 + 0.025 * Math.sin(t * 2.6)) * ease * (g.userData.active ? 1.3 : 0.9);

    // Soft-yaw so the hologram faces the player (works from either side of the table)
    floatG.getWorldPosition(_holoWorldPos);
    _holoCamDir.subVectors(camera.position, _holoWorldPos);
    _holoCamDir.y = 0;
    if (_holoCamDir.lengthSq() > 1e-6) {
      _holoCamDir.normalize();
      const targetYaw = Math.atan2(_holoCamDir.x, _holoCamDir.z);
      g.getWorldQuaternion(_holoParentQuat);
      _holoParentEuler.setFromQuaternion(_holoParentQuat, 'YXZ');
      const localYaw = targetYaw - _holoParentEuler.y;
      let dy = localYaw - floatG.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      floatG.rotation.y += dy * 0.14;
    }

    // Which face is toward the player? (local +Z vs camera)
    floatG.updateMatrixWorld(true);
    floatG.getWorldDirection(_holoFront);
    _holoCamDir.subVectors(camera.position, _holoWorldPos).normalize();
    const facing = _holoFront.dot(_holoCamDir) >= 0 ? 1 : -1;
    g.userData.facingSide = facing;

    // Show only the face oriented toward the player for 100% solid, non-transparent rendering
    if (facing >= 0) {
      front.visible = true;
      backFace.visible = false;
    } else {
      backFace.visible = true;
      front.visible = false;
    }

    // Dynamic Expanding Holographic Wavefield FX
    const pulse = Math.sin(t * 3.2);
    coreMat.emissiveIntensity = (1.2 + 0.35 * pulse) * ease * (g.userData.active ? 1.3 : 1.0);
    ledMat.emissiveIntensity = (1.0 + 0.3 * Math.sin(t * 2.8)) * ease * (g.userData.active ? 1.2 : 1.0);
    holoLight.intensity = (g.userData.active ? 0.75 : 0.42 + 0.15 * pulse) * ease;

    // Upward expanding and diffusing harmonic wave pulse rings
    waveRings.forEach(({ mesh, mat: rm, phase: rPhase }) => {
      const progress = (t * 0.65 + rPhase) % 1.0;
      const ringY = 0.08 + progress * (0.70 * ease);
      mesh.position.y = ringY;
      const currentRadius = (0.04 + progress * 0.30) * (0.4 + 0.6 * ease);
      const scale = currentRadius / 0.1;
      mesh.scale.set(scale, scale, 1);
      const ringOpacity = Math.sin(progress * Math.PI) * (g.userData.active ? 0.55 : 0.38) * ease;
      rm.opacity = ringOpacity;
      mesh.rotation.z = t * (0.85 + rPhase * 0.4);
    });

    draw(!!g.userData.active);
  });

  return g;
}

/**
 * Large floating content display in front of each experiment table.
 * Shows experiment steps/controls; activated by the tabletop selector terminal.
 * Continuous param sliders live on the tabletop desk panel (not on this screen).
 */
function makeStationDisplay(stationId, title, accentHex, accentNum = 0x38bdf8, screenRegistry = null) {
  const g = new THREE.Group();
  // Content panel sized for dense HUD layouts (not a wall-filling blank canvas).
  const panelW = 2.55;
  const panelH = 1.55;
  const fullTitle = STATION_LABEL[stationId] || title;
  const enTitle = STATION_EN[stationId] || 'STATION';
  const SURFACE = 'display';

  // Fixed modest resolution: full dense UI still fits; ~half the fill cost of 1280×1200.
  // Never reallocate on experiment switch (that was a major hitch).
  const FIXED_DISPLAY_W = 960;
  const FIXED_DISPLAY_H = 720;
  let c = document.createElement('canvas');
  c.width = FIXED_DISPLAY_W;
  c.height = FIXED_DISPLAY_H;
  let ctx = c.getContext('2d');
  let lastDrawKey = '';
  let hitRegions = [];
  let boundHud = null;
  let boundDataHtml = '';

  g.userData.maximized = false;
  g.userData._baseY = 0;
  g.userData.accentHex = accentHex;
  g.userData.fullTitle = fullTitle;
  g.userData.enTitle = enTitle;
  g.userData.surface = SURFACE;
  g.userData.contentScreenCategory = stationId;

  const createScreenTexture = () => {
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Anisotropy is free at rest but costs on every texture upload — keep low.
    texture.anisotropy = 1;
    return texture;
  };
  let tex = createScreenTexture();
  // Base plane design size is panelW×panelH mapped from 1280×800 reference.
  g.userData._fixedScale = {
    sx: FIXED_DISPLAY_W / 1280,
    sy: FIXED_DISPLAY_H / 800,
  };

  const screenMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 1.0,
    side: THREE.FrontSide,
    depthWrite: false,
    toneMapped: false,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), screenMat);
  screen.position.z = 0.01;
  screen.renderOrder = 1;
  g.add(screen);

  // Soft rear face so the panel stays readable if viewed from a slight angle
  const backMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.22,
    side: THREE.FrontSide,
    depthWrite: false,
    toneMapped: false,
  });
  const backFace = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), backMat);
  backFace.rotation.y = Math.PI;
  backFace.position.z = -0.03;
  backFace.renderOrder = 1;
  g.add(backFace);

  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(panelW + 0.12, panelH + 0.12, 0.18),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  g.add(hit);

  const panelLight = new THREE.PointLight(0xf8fafc, 0, 4.5, 2);
  panelLight.position.set(0, 0, 0.35);
  g.add(panelLight);

  // Apply fixed canvas aspect to meshes once at build (no switch-time resize).
  if (g.userData._fixedScale) {
    const { sx, sy } = g.userData._fixedScale;
    screen.scale.set(sx, sy, 1);
    backFace.scale.set(sx, sy, 1);
    hit.scale.set(sx, sy, 1);
    g.userData.canvasW = FIXED_DISPLAY_W;
    g.userData.canvasH = FIXED_DISPLAY_H;
    g.userData.screenWorldSize = { width: panelW * sx, height: panelH * sy };
  }

  // Hidden until an experiment is selected on the tabletop terminal.
  g.visible = false;
  g.userData.present = false;

  /** Layout is fixed for the lifetime of the panel — never realloc on switch. */
  const syncScreenLayout = () => false;

  /**
   * Cheap first paint after switch: solid glass + title only.
   * Full dense controls arrive on a later budget pulse.
   */
  const paintShell = (titleText = '加载实验界面…') => {
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillRect(12, 12, W - 24, H - 24);
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 12, W - 24, H - 24);
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 36px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(titleText || fullTitle).slice(0, 28), W / 2, H * 0.42);
    ctx.fillStyle = '#0369a1';
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillText('界面加载中…', W / 2, H * 0.52);
    hitRegions = [];
    g.userData.hitRegions = hitRegions;
    // Shell is a non-interactive placeholder — never treat it as live content.
    g.userData._contentExpId = null;
    lastDrawKey = `shell|${titleText}`;
    tex.needsUpdate = true;
  };

  const draw = (active, force = false) => {
    const layoutChanged = syncScreenLayout(active);
    const rev = boundHud?._rev ?? 0;
    const maxed = g.userData.maximized ? 1 : 0;
    const pressedKey = g.userData._pressedHitId || '';
    const expDataKey = boundHud?.data
      ? `${boundHud.data.showCurve ? 1 : 0}|${boundHud.data.showFit ? 1 : 0}|${boundHud.data.target || ''}|${boundHud.data.tableScrollTop ?? ''}`
      : '';
    const key = `${active ? 1 : 0}|${maxed}|${rev}|${expDataKey}|${pressedKey}|${boundHud?.expId || ''}|${boundHud?.stepIndex ?? ''}|${boundHud?.step?.hint || ''}|${boundHud?.running ? 1 : 0}|${c.width}x${c.height}|${boundDataHtml}`;
    if (!force && !layoutChanged && key === lastDrawKey) return;
    lastDrawKey = key;

    const result = drawHoloScreen(ctx, c.width, c.height, {
      accentHex,
      fullTitle,
      enTitle,
      active: !!active,
      hud: active ? boundHud : null,
      dataHtml: boundDataHtml,
      maximized: !!g.userData.maximized,
      surface: SURFACE,
      theme: 'light',
      pressedPick: g.userData._pressedHit || null,
    });
    hitRegions = result.hits || [];
    g.userData.hitRegions = hitRegions;
    g.userData.boundHud = boundHud;
    g.userData.boundDataHtml = boundDataHtml;
    tex.needsUpdate = true;
  };
  paintShell(fullTitle);
  g.userData.paintShell = paintShell;
  g.userData.paintFull = () => {
    if (boundHud?.running && boundHud?.experiment) draw(true, false);
  };

  // Stay in the interactables list; presence is gated in pick/aim/visible.
  // (Toggling interactive + recollecting the whole scene every HUD push froze the app.)
  const tag = (o) => {
    o.userData.type = 'holo_display';
    o.userData.role = 'holo_display';
    o.userData.stationId = stationId;
    o.userData.interactive = true;
  };
  tag(g);
  tag(hit);
  tag(screen);
  tag(backFace);
  defineInteractionTarget(g, {
    kind: INTERACTION_KIND.HOLO_DISPLAY,
    role: 'holo_display',
    stationId,
  });

  function setPresent(on) {
    const present = !!on;
    // Critical: HUD updates every frame while experiments run — only flip visibility
    // when presence actually changes. Never recollect the scene here.
    if (g.userData.present === present && g.visible === present) {
      if (!present) screenRegistry?.release?.(stationId);
      g.userData.active = present;
      return;
    }
    g.userData.present = present;
    g.userData.active = present;
    g.visible = present;
    panelLight.intensity = present ? 0.55 : 0;
    if (!present) {
      screenRegistry?.release?.(stationId);
      hitRegions = [];
      g.userData.hitRegions = [];
      g.userData._contentExpId = null;
      // Hide path: skip raycast rebinding on the close click (was a small hitch
      // ×4 stations). Disabled meshes stay non-interactive while invisible;
      // re-enable when shown again.
      [hit, screen, backFace].forEach((mesh) => {
        mesh.raycast = () => {};
      });
      return;
    }
    // Show path: restore raycasts.
    [hit, screen, backFace].forEach((mesh) => {
      mesh.raycast = THREE.Mesh.prototype.raycast;
    });
  }

  // Start with raycasts disabled (hidden).
  [hit, screen, backFace].forEach((mesh) => {
    mesh.raycast = () => {};
  });

  g.userData.draw = draw;
  g.userData.tex = tex;
  g.userData.screenFaces = [screen, backFace];
  g.userData.screenRoot = g;
  g.userData.canvasW = c.width;
  g.userData.canvasH = c.height;
  g.userData.setPresent = setPresent;

  g.userData.setHud = (hud, dataHtml = '', opts = {}) => {
    boundHud = hud;
    boundDataHtml = dataHtml || '';
    const running = !!(hud?.running && hud?.experiment);
    setPresent(running);
    if (!running) {
      lastDrawKey = '';
      g.userData._contentExpId = null;
      return;
    }
    const expId = hud.experiment?.id || hud.expId || '';
    // Bind only the content state. The registered category screen itself is
    // retained across experiment changes and category menu visits.
    const binding = screenRegistry?.bind?.(stationId, expId);
    if (binding) g.userData.contentScreenBinding = binding;
    // shell: cheap placeholder; full: dense controls (caller should budget this).
    if (opts.shell) {
      // Electro (and others) throttle-push HUD every ~0.1–0.35s. Re-painting the
      // shell on every push wipes hitRegions and, under the one-job-per-pulse
      // frame budget, can starve/clobber the full interactive paint — making
      // the content screen look live but refuse clicks.
      if (
        g.userData._contentExpId === expId
        && Array.isArray(hitRegions)
        && hitRegions.length > 0
      ) {
        return;
      }
      paintShell(hud.experiment?.name || fullTitle);
      return;
    }
    // Skip redundant full layout when content is already interactive.
    if (
      opts.skipIfLive
      && g.userData._contentExpId === expId
      && Array.isArray(hitRegions)
      && hitRegions.length > 0
    ) {
      return;
    }
    draw(true, !!opts.force);
    // Mark this experiment's dense UI as live so subsequent shell jobs no-op.
    if (Array.isArray(hitRegions) && hitRegions.length > 0) {
      g.userData._contentExpId = expId;
    }
  };
  g.userData.setMaximized = (on) => {
    // Flag only — next budget paint refreshes the maximize chrome icon.
    // Sync draw(true,true) on close was a major post-fullscreen hitch.
    if (g.userData.maximized === !!on) return;
    g.userData.maximized = !!on;
    lastDrawKey = '';
  };
  g.userData.pick = (uv) => {
    if (!uv || !g.userData.present) return null;
    return pickHoloScreen(uv.x, uv.y, c.width, c.height, hitRegions, 1);
  };

  const _pickPlane = new THREE.Plane();
  const _pickHit = new THREE.Vector3();
  const _pickLocal = new THREE.Vector3();
  const _pickN = new THREE.Vector3();

  function uvOnFacePlane(raycaster, face) {
    face.updateMatrixWorld(true);
    _pickN.set(0, 0, 1).transformDirection(face.matrixWorld).normalize();
    face.getWorldPosition(_holoWorldPos);
    _pickPlane.setFromNormalAndCoplanarPoint(_pickN, _holoWorldPos);
    const ray = raycaster.ray;
    if (!ray.intersectPlane(_pickPlane, _pickHit)) return null;
    _pickLocal.subVectors(_pickHit, ray.origin);
    if (_pickLocal.dot(ray.direction) < 1e-4) return null;
    _pickLocal.copy(_pickHit);
    face.worldToLocal(_pickLocal);
    const u = (_pickLocal.x / panelW) + 0.5;
    const v = (_pickLocal.y / panelH) + 0.5;
    if (u < -0.08 || u > 1.08 || v < -0.08 || v > 1.08) return null;
    return {
      u: THREE.MathUtils.clamp(u, 0, 1),
      v: THREE.MathUtils.clamp(v, 0, 1),
      distance: ray.origin.distanceTo(_pickHit),
    };
  }

  function collectScreenSamples(raycaster) {
    g.updateMatrixWorld(true);
    screen.updateMatrixWorld(true);
    backFace.updateMatrixWorld(true);
    const samples = [];
    for (const face of [screen, backFace]) {
      const uvInfo = uvFromRayAndMesh(raycaster, face) || uvOnFacePlane(raycaster, face);
      if (!uvInfo) continue;
      samples.push({ face, ...uvInfo });
    }
    samples.sort((a, b) => a.distance - b.distance);
    return samples;
  }

  g.userData.screenAimFromRay = (raycaster) => {
    // Only claim aim while this content panel is present (experiment selected).
    if (!g.userData.present || !g.visible) return null;
    const samples = collectScreenSamples(raycaster);
    return samples[0] || null;
  };

  g.userData.pickFromRay = (raycaster) => {
    if (!g.userData.present || !g.visible) return null;
    const samples = collectScreenSamples(raycaster);
    if (!samples.length) return null;
    for (const s of samples) {
      const side = s.face === backFace ? -1 : 1;
      const pick = pickHoloScreen(s.u, s.v, c.width, c.height, hitRegions, side);
      if (pick) return pick;
    }
    const s0 = samples[0];
    return pickHoloScreen(s0.u, s0.v, c.width, c.height, hitRegions, s0.face === backFace ? -1 : 1);
  };

  // Gentle float + soft face toward the player (only while present)
  animators.push((t) => {
    if (!g.userData.present || !g.visible) {
      panelLight.intensity = 0;
      return;
    }
    const phase = t + stationId.length * 1.1 + 2.1;
    g.position.y = g.userData._baseY + Math.sin(phase * 1.1) * 0.03;

    g.getWorldPosition(_holoWorldPos);
    _holoCamDir.subVectors(camera.position, _holoWorldPos);
    _holoCamDir.y = 0;
    if (_holoCamDir.lengthSq() > 1e-6) {
      _holoCamDir.normalize();
      const targetYaw = Math.atan2(_holoCamDir.x, _holoCamDir.z);
      let dy = targetYaw - g.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      g.rotation.y += dy * 0.08;
    }

    const pulse = 0.95 + 0.03 * Math.sin(t * 2.1);
    screenMat.opacity = THREE.MathUtils.clamp(pulse, 0.92, 0.99);
    backMat.opacity = 0.22;
    panelLight.intensity = 0.38 + 0.08 * Math.sin(t * 2.4);
    haloMat.opacity = 0.45 + 0.15 * Math.sin(t * 2.5);
    stabMat.opacity = 0.30 + 0.15 * Math.sin(t * 3.0);

    draw(true);
  });

  return g;
}

// Wall-side table edges; hologram free-yaws toward the player from either side
// tables: mechanics/optics w=3.4 @ x=±4.2,z=-2.8 | electro/thermo w=2.8 @ x=±4.2,z=2.6
const holoConfigs = [
  { id: 'mechanics', title: '力学', accent: '#38bdf8', accentNum: 0x38bdf8, pos: [-5.72, 0.93, -2.8], rotY: -Math.PI / 2 },
  { id: 'electro', title: '电磁学', accent: '#f472b6', accentNum: 0xf472b6, pos: [-5.42, 0.93, 2.6], rotY: Math.PI / 2 },
  { id: 'optics', title: '光学', accent: '#fbbf24', accentNum: 0xfbbf24, pos: [5.72, 0.93, -2.8], rotY: Math.PI / 2 },
  { id: 'thermo', title: '热力学', accent: '#fb923c', accentNum: 0xfb923c, pos: [5.42, 0.93, 2.6], rotY: Math.PI / 2 },
];
// Front-of-table floating content screens: table "front" faces the chalkboard wall (-Z).
// Positioned close to the back edge of each table at comfortable eye level.
// Param sliders are physical controls flush on the sitting edge (see deskSliderPanels).
const displayConfigs = [
  { id: 'mechanics', title: '力学', accent: '#38bdf8', accentNum: 0x38bdf8, pos: [-3.4, 1.78, -3.75], rotY: 0 },
  { id: 'optics', title: '光学', accent: '#fbbf24', accentNum: 0xfbbf24, pos: [4.2, 1.78, -3.75], rotY: 0 },
  // Content displays float at comfortable eye level with balanced distance to the bench
  { id: 'electro', title: '电磁学', accent: '#f472b6', accentNum: 0xf472b6, pos: [-3.4, 1.76, 1.72], rotY: 0 },
  { id: 'thermo', title: '热力学', accent: '#fb923c', accentNum: 0xfb923c, pos: [4.2, 1.58, 1.72], rotY: 0 },
];
const holos = {};
const stationDisplays = {};
const contentScreenRegistry = createContentScreenRegistry();
holoConfigs.forEach(({ id, title, accent, accentNum, pos, rotY }) => {
  const h = makeHoloPanel(id, title, accent, accentNum);
  h.position.set(...pos);
  h.rotation.y = rotY;
  scene.add(h);
  holos[id] = h;
});
displayConfigs.forEach(({ id, title, accent, accentNum, pos, rotY }) => {
  const d = makeStationDisplay(id, title, accent, accentNum, contentScreenRegistry);
  d.position.set(...pos);
  d.rotation.y = rotY;
  d.userData._baseY = pos[1];
  d.position.y = pos[1];
  scene.add(d);
  stationDisplays[id] = d;
  contentScreenRegistry.register(id, d);
  if (holos[id]) holos[id].userData.display = d;
});

// Tabletop param sliders — flush on the sitting edge, clear of apparatus.
// Table tops: makeTechTable h=0.88, top thickness 0.05 → surface y ≈ 0.905.
// mechanics/optics: w=3.4 d=1.15 @ (±4.2, -2.8) → x∈[±2.5,±5.9], z∈[-3.375,-2.225]
// electro/thermo:   w=2.8 d=1.1  @ (±4.2,  2.6) → x∈[±2.8,±5.6], z∈[ 2.05, 3.15]
// Sitting edge = table +Z. Panel grows inward (−Z). X parks next to the nameplate
// in the free front corner so multi-row cards don't sit under the experiment rail.
const DESK_TOP_Y = 0.908;
const DESK_SLIDER_LAYOUT = {
  // mechanics nameplate @ (-2.85, -2.32) → panel further −X (room-outer free corner)
  mechanics: {
    worldX: -4.55, worldY: DESK_TOP_Y, worldZ: -2.24,
    face: '+z', accent: '#38bdf8', accentNum: 0x38bdf8,
  },
  // electro: right of Faraday/Hall rail, mid-depth of the table (not sitting edge).
  // Table z∈[2.05, 3.15] centre≈2.6; apparatus ~x=-4.15 → panel at free +X strip.
  electro: {
    worldX: -3.12, worldY: DESK_TOP_Y, worldZ: 2.72,
    face: '+z', accent: '#f472b6', accentNum: 0xf472b6,
  },
  // optics nameplate @ (2.85, -2.32) → panel just inside nameplate (front-left free strip)
  optics: {
    worldX: 3.55, worldY: DESK_TOP_Y, worldZ: -2.24,
    face: '+z', accent: '#fbbf24', accentNum: 0xfbbf24,
  },
  // thermo nameplate @ (3.2, 3.02) → panel further +X
  thermo: {
    worldX: 5.18, worldY: DESK_TOP_Y, worldZ: 3.13,
    face: '+z', accent: '#fb923c', accentNum: 0xfb923c,
  },
};
const deskSliderPanels = {};
Object.entries(DESK_SLIDER_LAYOUT).forEach(([id, cfg]) => {
  const panel = createDeskSliderPanel({
    stationId: id,
    accentHex: cfg.accent,
    accentNum: cfg.accentNum,
  });
  panel.userData.setEdgeAnchor?.({
    worldX: cfg.worldX,
    worldY: cfg.worldY,
    worldZ: cfg.worldZ,
    face: cfg.face,
  });
  scene.add(panel);
  deskSliderPanels[id] = panel;
});

function syncDeskSlidersFromHud(payload) {
  const activeId = payload?.station?.id || payload?.stationId || null;
  const running = !!payload?.running;
  const expId = payload?.experiment?.id || payload?.expId || null;
  const data = payload?.data || {};
  const experiment = payload?.experiment || null;

  Object.entries(deskSliderPanels).forEach(([id, panel]) => {
    if (!panel?.userData) return;
    const want = running && id === activeId && !!expId;
    if (!want) {
      if (panel.userData.present) panel.userData.setPresent?.(false);
      panel.userData._deskSig = '';
      return;
    }
    const { title, specs } = getDeskSliderConfig(id, expId, data, experiment);
    const sig = `${expId}|${specs.map((s) => {
      if (s.kind === 'actionGroup') {
        const btns = (s.buttons || []).map((b) => `${b.label}:${b.action}:${!!b.active}`).join(';');
        return `group:${s.key}:${btns}`;
      }
      return `${s.key}:${s.target || ''}:${s.min}:${s.max}:${s.action}:${s.label || ''}`;
    }).join(',')}`;
    if (panel.userData._deskSig !== sig) {
      panel.userData._deskSig = sig;
      panel.userData.setSpecs?.(specs, title);
    }
    if (!panel.userData.present) panel.userData.setPresent?.(true);
    panel.userData.syncValues?.((spec) => readDeskSliderValue(spec, data, experiment));
  });
}

// Build equipment refs for experiment manager
const equipment = {
  holos,
  displays: stationDisplays,
  deskSliders: deskSliderPanels,
  mechanics: stationScenes.mechanics?.equipment || null,
  optics: stationScenes.optics?.equipment || null,
  electro: stationScenes.electro?.equipment || null,
  thermo: stationScenes.thermo?.equipment || null,
};
const loadedStationModules = {};

function disposeStationResources(root) {
  if (!root?.traverse) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry?.dispose && !geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose();
    }
    const values = Array.isArray(object.material) ? object.material : [object.material];
    values.forEach((material) => {
      if (!material || materials.has(material)) return;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && !textures.has(value)) {
          textures.add(value);
          value.dispose?.();
        }
      }
      material.dispose?.();
    });
  });
  root.parent?.remove(root);
}

// Keep all five station shells warm on the target desktop profile. This is a
// bounded reuse pool: station switches toggle visibility and lifecycle state
// without tearing down geometry/materials and rebuilding them on the next visit.
const stationCacheBudget = runtimeCacheBudget();
const stationRuntimeCache = createRuntimeCache({
  ...stationCacheBudget,
  maxWarm: Math.max(stationCacheBudget.maxWarm, 5),
  budgetBytes: Math.max(stationCacheBudget.budgetBytes, 80 * 1024 * 1024),
});

// A menu showcase is intentionally asynchronous, but it must never win over
// a card selection that started after the menu was opened.
let stationShowcaseGeneration = 0;

/** Instantiate one station scene after a confirmed menu / stable prediction. */
const stationLoadPromises = new Map();
/** Experiment handler modules — loaded only on card focus / start intent. */
const experimentModulePromises = new Map();

async function ensureStationLoaded(stationId) {
  const entry = stationScenes[stationId];
  if (!entry) throw new Error(`Unknown station: ${stationId}`);
  if (!entry.proxy) return entry;
  if (stationLoadPromises.has(stationId)) return stationLoadPromises.get(stationId);

  const promise = (async () => {
    // Menu intent loads the station scene only. Experiment handlers arrive on
    // card focus / start so opening a terminal stays metadata + geometry shell.
    const sceneModule = await loadStationModule(stationId);
    const createStation = sceneModule.createStationEquipment || sceneModule.default;
    if (typeof createStation !== 'function') throw new Error(`Invalid station module: ${stationId}`);
    registeringStationId = stationId;
    let station;
    try {
      // Station factories are deliberately lightweight shells. Do not route
      // this path through runHeavyChunk: waiting for rendered frames here
      // makes a menu/card click inherit the current renderer stall.
      station = createStation(stationContext);
    } finally {
      registeringStationId = null;
    }
    entry.root.parent?.remove(entry.root);
    entry.root = station.root;
    entry.equipment = station.equipment;
    entry.refs = station.refs || {};
    entry.animators = station.animators || [];
    entry.proxy = false;
    scene.add(entry.root);
    equipment[stationId] = entry.equipment;
    if (stationId === 'electro') hallBench = entry.refs.hallBench || hallBench;
    stationAnimators[stationId] = [];
    entry.animators.forEach((fn) => stationContext.registerAnimator(fn, { stationId }));
    const loadedRoot = entry.root;
    stationRuntimeCache.activate(stationId, {
      id: stationId,
      suspend: () => entry.equipment?.suspend?.(),
      unmount: () => { loadedRoot.visible = false; loadedRoot.parent?.remove(loadedRoot); },
      estimateBytes: () => ({ cpu: 8 * 1024 * 1024, gpu: 12 * 1024 * 1024 }),
      dispose: () => {
        disposeStationResources(loadedRoot);
        stationAnimators[stationId] = [];
        const proxy = createStationProxy(stationId);
        entry.root = proxy.root;
        entry.equipment = proxy.equipment;
        entry.refs = proxy.refs;
        entry.animators = [];
        entry.proxy = true;
        equipment[stationId] = proxy.equipment;
        scene.add(proxy.root);
        if (stationId === 'electro') hallBench = proxy.refs.hallBench;
        stationLoadPromises.delete(stationId);
        experimentModulePromises.delete(stationId);
        delete loadedStationModules[stationId];
      },
    });
    stationPickableDirty[stationId] = true;
    stationSurfaceCache[stationId] = null;
    return entry;
  })();
  stationLoadPromises.set(stationId, promise);
  try {
    return await promise;
  } catch (error) {
    stationLoadPromises.delete(stationId);
    throw error;
  }
}

/**
 * Load experiment handlers after a confirmed experiment intent (focus / start).
 * Concurrent callers for the same station share one Promise.
 */
async function ensureExperimentModuleLoaded(stationId, expId = null) {
  if (!stationId) throw new Error('stationId required');
  if (loadedStationModules[stationId]) return loadedStationModules[stationId];
  if (experimentModulePromises.has(stationId)) return experimentModulePromises.get(stationId);

  const promise = (async () => {
    const experimentModule = expId
      ? await loadExperimentModule(expId, stationId)
      : await loadStationExperimentModule(stationId);
    registerStationCatalog(experimentModule.station);
    loadedStationModules[stationId] = experimentModule;
    expManager?.registerStationModule?.(stationId, experimentModule, experimentModule.station);
    return experimentModule;
  })();
  experimentModulePromises.set(stationId, promise);
  try {
    return await promise;
  } catch (error) {
    experimentModulePromises.delete(stationId);
    throw error;
  }
}

/** Load a source runtime only after an experiment intent is known. */
async function ensureExperimentRuntimeLoaded(stationId, expId) {
  await ensureExperimentModuleLoaded(stationId, expId);
  if (stationId !== 'thermo') return true;
  const entry = stationScenes[stationId];
  if (!entry || entry.proxy) return false;
  const Runtime = await loadStationExperimentRuntime(stationId, expId);
  return !!entry.equipment?.registerExperiment?.(expId, Runtime);
}

/**
 * Apply the station's idle showcase after a menu intent. Thermo/optics clear
 * the tabletop until a card is chosen; other stations may keep a visual prop.
 * Guarded against a concurrent experiment switch via generation + manager state.
 */
async function revealStationShowcase(stationId, generation = stationShowcaseGeneration) {
  const entry = stationScenes[stationId];
  if (!entry || entry.proxy) return false;
  if (generation !== stationShowcaseGeneration) return false;
  if (expManager?.state?.stationId !== stationId || !expManager?.state?.menuOpen
    || expManager?.state?.running) return false;
  const shown = !!entry.equipment?.showcase?.();
  if (shown) {
    stationPickableDirty[stationId] = true;
    stationSurfaceCache[stationId] = null;
    if (stationPresence?.getHotStation?.() === stationId) assembleInteractablesFromCache();
  }
  return shown;
}



// DOM HUD for experiments
const expPanel = document.getElementById('exp-panel');
const expList = document.getElementById('exp-list');
const expActive = document.getElementById('exp-active');
const expStationTitle = document.getElementById('exp-station-title');
const expName = document.getElementById('exp-name');
const expTheory = document.getElementById('exp-theory');
const expSteps = document.getElementById('exp-steps');
const expHint = document.getElementById('exp-hint');
const expData = document.getElementById('exp-data');
const toastEl = document.getElementById('toast');
const crosshair = document.getElementById('crosshair');
let toastTimer = 0;

function getActiveToastElement() {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  } else if (el.closest?.('#legacy-ui')) {
    document.body.appendChild(el);
  }
  return el;
}

function showToast(msg) {
  const el = getActiveToastElement();
  if (el) {
    el.textContent = msg;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('show', 'pulse');
  }
  clearTimeout(toastTimer);
  updateToast(msg);
  toastTimer = setTimeout(() => {
    if (el) el.classList.remove('show', 'pulse');
    updateToast(null);
  }, 2400);
}

let activeExperimentSwitches = 0;

function beginExperimentSwitchLoader(label = '实验') {
  let node = document.getElementById('experiment-switch-loader');
  if (!node) {
    node = document.createElement('div');
    node.id = 'experiment-switch-loader';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.innerHTML = '<span class="experiment-switch-spinner" aria-hidden="true"></span><span data-switch-loader-label></span>';
    document.body.appendChild(node);
  }

  const labelNode = node.querySelector('[data-switch-loader-label]');
  if (labelNode) labelNode.textContent = `正在加载 ${label}…`;
  activeExperimentSwitches += 1;
  node.classList.add('show');
  node.setAttribute('aria-busy', 'true');

  let ended = false;
  return {
    setMessage(message) {
      if (labelNode && message) labelNode.textContent = message;
    },
    end() {
      if (ended) return;
      ended = true;
      activeExperimentSwitches = Math.max(0, activeExperimentSwitches - 1);
      if (activeExperimentSwitches === 0) {
        node.classList.remove('show');
        node.setAttribute('aria-busy', 'false');
      }
    },
  };
}

let aimHudEl = document.getElementById('aim-hud');
let aimLedEl = null;
let aimTargetEl = null;
let aimBadgeEl = null;

function ensureAimHud() {
  if (!aimHudEl) {
    aimHudEl = document.createElement('div');
    aimHudEl.id = 'aim-hud';
    aimHudEl.className = 'aim-hud';
    aimHudEl.innerHTML = `
      <span class="aim-hud-led" id="aim-hud-led"></span>
      <span class="aim-hud-target" id="aim-hud-target">准星焦点: 无对准目标</span>
      <span class="aim-hud-badge" id="aim-hud-badge">无法交互</span>
    `;
    document.body.appendChild(aimHudEl);
  }
  aimLedEl = document.getElementById('aim-hud-led');
  aimTargetEl = document.getElementById('aim-hud-target');
  aimBadgeEl = document.getElementById('aim-hud-badge');
}

let _lastAimTarget = undefined;
let _lastAimCanInteract = undefined;
let _lastAimTitle = '';
let _lastAimBadgeText = '';
let _lastAimInteractive = undefined;

function updateAimHud(target, canInteract) {
  ensureAimHud();
  if (!aimHudEl || !aimTargetEl) return;

  if (!target) {
    if (_lastAimTarget !== null) {
      _lastAimTarget = null;
      _lastAimCanInteract = canInteract;
      _lastAimTitle = '';
      _lastAimBadgeText = '';
      _lastAimInteractive = false;
      aimTargetEl.textContent = '准星焦点: 空置区域 / 环境';
      if (aimLedEl) aimLedEl.className = 'aim-hud-led';
      if (aimBadgeEl) {
        aimBadgeEl.textContent = '无法交互';
        aimBadgeEl.className = 'aim-hud-badge';
      }
    }
    return;
  }

  const role = target.userData?.role;

  let title = '未知设备';
  let isInteractive = !!(target.userData?.interactive || canInteract);
  let badgeText = isInteractive ? '可交互' : '只读';

  if (target.userData?.type === 'holo_display' || target.userData?.role === 'holo_display') {
    const pick = target.userData?.pickFromRay?.(raycaster);
      if (pick) {
        if (pick.action === 'hall-chart') {
          const showCurve = expManager?.state?.data?.showCurve;
          title = showCurve ? '返回数据记录' : '生成 B–X 曲线';
          badgeText = '点击切换';
          isInteractive = true;
        } else if (pick.action === 'hall-fit') {
          const isFitting = expManager?.state?.data?.showCurve && expManager?.state?.data?.showFit;
          title = isFitting ? '隐藏拟合曲线' : '拟合理论曲线';
          badgeText = '点击拟合';
          isInteractive = true;
        } else if (pick.action === 'hall-export') {
          title = '导出实验数据';
          badgeText = '点击导出';
          isInteractive = true;
        } else if (pick.action === 'hall-clear') {
          title = '清空实验记录';
          badgeText = '点击清空';
          isInteractive = true;
        } else if (pick.action === 'hall-target') {
          const isHelm = pick.target === 'helmholtz';
          title = isHelm ? '选择：亥姆霍兹线圈' : '选择：长螺线管';
          badgeText = '点击切换';
          isInteractive = true;
        } else if (pick.action === 'hall-identify') {
          title = pick.label || '器材识别确认';
          badgeText = '点击确认';
          isInteractive = true;
        } else if (pick.action === 'maximize') {
          title = target.userData?.maximized ? '还原悬浮窗' : '全屏显示';
          badgeText = '点击切换';
          isInteractive = true;
        } else if (pick.action === 'close') {
          title = '关闭实验面板';
          badgeText = '点击关闭';
          isInteractive = true;
        } else if (pick.label || pick.title) {
          title = pick.label || pick.title;
          badgeText = '点击操作';
          isInteractive = true;
        } else {
          title = '悬浮显示屏控件';
          badgeText = '点击操作';
          isInteractive = true;
        }
      } else {
        title = '悬浮显示屏';
        badgeText = '瞄准按钮';
        isInteractive = false;
      }
  } else if (target.userData?.type === 'formula_board' || role === 'formula_board') {
    title = '公式知识卡片墙';
    badgeText = '点击展开';
  } else if (target.userData?.type === 'side_blackboard' || role === 'side_blackboard') {
    title = '实验室黑板';
    badgeText = '书写/擦除';
  } else if (target.name || target.userData?.title || role) {
    title = target.userData?.title || target.name || role;
  }

  _lastAimTarget = target;
  _lastAimCanInteract = canInteract;
  if (title !== _lastAimTitle) {
    _lastAimTitle = title;
    aimTargetEl.textContent = `准星对准: ${title}`;
  }
  if (isInteractive !== _lastAimInteractive) {
    _lastAimInteractive = isInteractive;
    if (aimLedEl) {
      aimLedEl.className = isInteractive ? 'aim-hud-led active' : 'aim-hud-led';
    }
  }
  if (badgeText !== _lastAimBadgeText || isInteractive !== _lastAimInteractive) {
    _lastAimBadgeText = badgeText;
    if (aimBadgeEl) {
      aimBadgeEl.textContent = badgeText;
      aimBadgeEl.className = isInteractive ? 'aim-hud-badge interactive' : 'aim-hud-badge';
    }
  }
}

const formatData = formatExperimentData;

/** Monotonic revision so hologram screens redraw when HUD changes */
let hudRev = 0;
let lastHudSnapshot = null;
let lastHudDataHtml = '';

// ── Fullscreen maximized hologram (covers the whole browser viewport) ──
const holoFsEl = document.getElementById('holo-fs');
const holoFsCanvas = document.getElementById('holo-fs-canvas');
const holoFullscreen = createHoloFullscreenController({
  element: holoFsEl,
  canvas: holoFsCanvas,
  drawScreen: drawHoloScreen,
  pickScreen: pickHoloScreen,
  getHolo: (stationId) => holos[stationId],
  getDisplay: (stationId) => stationDisplays[stationId],
  getHud: () => lastHudSnapshot,
  getDataHtml: () => lastHudDataHtml,
  scheduler: labFrameScheduler,
  unlockControls: () => { if (controls.isLocked) controls.unlock(); },
  onToast: showToast,
});
const holoFsState = holoFullscreen.state;
const resizeHoloFsCanvas = () => holoFullscreen.resize();
const paintHoloFs = () => holoFullscreen.paint();
const openHoloFullscreen = (stationId) => holoFullscreen.open(stationId);
const closeHoloFullscreen = (opts) => holoFullscreen.close(opts);
const toggleHoloFullscreen = (stationId) => holoFullscreen.toggle(stationId);
const mapFsClickToCanvas = (clientX, clientY) => holoFullscreen.pointFromClient(clientX, clientY);
const pickFsAt = (clientX, clientY) => holoFullscreen.pickAt(clientX, clientY);

if (holoFsCanvas) {
  /** @type {{ pointerId: number, lastY: number, moved: boolean, pick: object } | null} */
  let fsTableDrag = null;
  /** Unified fullscreen drag for faraday / induced-e / generic param sliders. */
  let fsSliderDrag = null;

  function fsSliderValueAt(clientX, pick) {
    const point = mapFsClickToCanvas(clientX, 0);
    if (!point || !pick) return null;
    return valueFromParamSliderPick({ ...pick, px: point.px });
  }

  function fsLiveSliderPick(fallback) {
    const action = fallback?.action;
    if (!action) return fallback;
    const live = (holoFsState.hits || []).find((h) => (
      h?.action === action
      && (!fallback?.key || h.key === fallback.key)
      && (!fallback?.axis || h.axis === fallback.axis)
      && (!fallback?.setAction || h.setAction === fallback.setAction)
    ));
    return live || fallback;
  }

  function fsDispatchSlider(pick, clientX) {
    const value = fsSliderValueAt(clientX, pick);
    if (!Number.isFinite(value)) return false;
    if (pick.action === 'faraday-b-slider') {
      expManager?.uiAction?.('faraday-b-set', { value });
      return true;
    }
    if (pick.action === 'induced-e-slider') {
      expManager?.uiAction?.('induced-e-set', { key: pick.key, value, live: true });
      return true;
    }
    if (pick.action === 'param-slider' && pick.setAction) {
      expManager?.uiAction?.(pick.setAction, {
        key: pick.key,
        value,
        axis: pick.axis,
        target: pick.target,
        live: true,
      });
      return true;
    }
    return false;
  }

  function fsDisplayTarget() {
    return {
      userData: {
        type: 'holo_display',
        role: 'holo_display',
        stationId: holoFsState.stationId,
        hitRegions: holoFsState.hits || [],
      },
    };
  }

  function fsScrollPick(atPick = null) {
    if (atPick?.action === 'hall-scroll-table' || atPick?.role === 'scrollable_table') return atPick;
    return (holoFsState.hits || []).find(
      (h) => h?.action === 'hall-scroll-table' || h?.role === 'scrollable_table',
    ) || atPick || null;
  }

  holoFsCanvas.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // A completed drag-scroll should not also fire the underlying control.
    if (fsTableDrag?.moved || fsSliderDrag?.moved) {
      fsTableDrag = null;
      fsSliderDrag = null;
      return;
    }
    const pick = pickFsAt(e.clientX, e.clientY);
    // Table region is scroll-only — clicks are not a discrete action.
    if (pick?.action === 'hall-scroll-table') return;
    // Continuous sliders are owned by pointerdown/move, not click.
    if (pick) handleHoloScreenAction(pick, holoFsState.stationId);
  });
  holoFsCanvas.addEventListener('pointerdown', (e) => {
    if (!holoFsState.open || e.button !== 0) return;
    const pick = pickFsAt(e.clientX, e.clientY);
    if (pick) {
      holoFsState.pressedPick = pick;
      paintHoloFs();
    }
    if (isParamSliderAction(pick?.action)) {
      fsSliderDrag = { pointerId: e.pointerId, pick, moved: false };
      fsDispatchSlider(pick, e.clientX);
      try { holoFsCanvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
      return;
    }
    if (pick?.action !== 'hall-scroll-table' && pick?.role !== 'scrollable_table') return;
    fsTableDrag = {
      pointerId: e.pointerId,
      lastY: e.clientY,
      moved: false,
      pick: fsScrollPick(pick),
    };
    try { holoFsCanvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  });
  holoFsCanvas.addEventListener('pointermove', (e) => {
    if (fsSliderDrag && fsSliderDrag.pointerId === e.pointerId) {
      const livePick = fsLiveSliderPick(fsSliderDrag.pick);
      if (fsDispatchSlider(livePick, e.clientX)) {
        fsSliderDrag.moved = true;
        fsSliderDrag.pick = livePick;
      }
      e.preventDefault();
      return;
    }
    if (!fsTableDrag || fsTableDrag.pointerId !== e.pointerId) {
      const pick = pickFsAt(e.clientX, e.clientY);
      if (pick?.action === 'hall-scroll-table' || pick?.role === 'scrollable_table') {
        holoFsCanvas.style.cursor = pick.scrollable === false ? 'default' : 'ns-resize';
      } else if (isParamSliderAction(pick?.action)) {
        holoFsCanvas.style.cursor = 'ew-resize';
      } else {
        holoFsCanvas.style.cursor = pick ? 'pointer' : 'default';
      }
      return;
    }
    const dy = e.clientY - fsTableDrag.lastY;
    fsTableDrag.lastY = e.clientY;
    if (Math.abs(dy) < 0.5) return;
    fsTableDrag.moved = true;
    // Refresh metrics after prior frames may have repainted the table.
    const livePick = fsScrollPick(fsTableDrag.pick);
    fsTableDrag.pick = livePick || fsTableDrag.pick;
    // Finger/content follows: drag up reveals later rows (same as wheel down).
    const ok = expManager?.uiAction?.('hall-scroll-table', {
      deltaPx: -dy,
      rowH: fsTableDrag.pick?.rowH,
      maxRows: fsTableDrag.pick?.maxRows,
      maxStart: fsTableDrag.pick?.maxStart,
    });
    if (ok) e.preventDefault();
  });
  const endFsPressFeedback = () => {
    setTimeout(() => {
      if (holoFsState.pressedPick) {
        holoFsState.pressedPick = null;
        paintHoloFs();
      }
    }, 120);
  };
  holoFsCanvas.addEventListener('pointerup', endFsPressFeedback);
  holoFsCanvas.addEventListener('pointercancel', endFsPressFeedback);
  holoFsCanvas.addEventListener('pointerleave', endFsPressFeedback);
  const endFsTableDrag = (e) => {
    if (!fsTableDrag || (e && fsTableDrag.pointerId !== e.pointerId)) return;
    try { holoFsCanvas.releasePointerCapture(fsTableDrag.pointerId); } catch { /* ignore */ }
    // Keep moved flag briefly so the trailing click is suppressed.
    const moved = fsTableDrag.moved;
    fsTableDrag = moved ? { ...fsTableDrag, pointerId: -1 } : null;
    if (moved) {
      setTimeout(() => { if (fsTableDrag?.pointerId === -1) fsTableDrag = null; }, 0);
    }
  };
  const endFsSliderDrag = (e) => {
    if (!fsSliderDrag || (e && fsSliderDrag.pointerId !== e.pointerId)) return;
    try { holoFsCanvas.releasePointerCapture(fsSliderDrag.pointerId); } catch { /* ignore */ }
    expManager?.endManipulation?.(
      { userData: { role: fsSliderDrag.pick?.role || fsSliderDrag.pick?.action || 'param-slider' } },
      { time: clock.elapsedTime },
    );
    const moved = fsSliderDrag.moved;
    fsSliderDrag = moved ? { ...fsSliderDrag, pointerId: -1 } : null;
    if (moved) setTimeout(() => { if (fsSliderDrag?.pointerId === -1) fsSliderDrag = null; }, 0);
  };
  holoFsCanvas.addEventListener('pointerup', endFsTableDrag);
  holoFsCanvas.addEventListener('pointercancel', endFsTableDrag);
  holoFsCanvas.addEventListener('pointerup', endFsSliderDrag);
  holoFsCanvas.addEventListener('pointercancel', endFsSliderDrag);
  holoFsCanvas.addEventListener('wheel', (e) => {
    if (!holoFsState.open || !expManager) return;
    const atPick = pickFsAt(e.clientX, e.clientY);
    const pick = fsScrollPick(atPick);
    // Match 3D behavior: wheel anywhere on the fullscreen content panel can
    // drive the data table when the record view is active (not only when the
    // cursor is pixel-perfect over the table rect).
    if (expManager.onWheel(e.deltaY, fsDisplayTarget(), pick)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, { passive: false });
}

window.addEventListener('resize', () => {
  if (!holoFsState.open) return;
  resizeHoloFsCanvas();
  paintHoloFs();
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && holoFsState.open) {
    e.preventDefault();
    // Esc exits fullscreen only — do not run full station shutdown on this frame.
    closeHoloFullscreen();
    labFrameScheduler.beginSoftSwitch?.(6);
    labFrameScheduler.rest?.(1);
    showToast('已退出全屏');
  }
});

/**
 * Holo HUD push — MUST stay cheap.
 * Never paint multiple large canvases in one call (that was the switch hitch).
 * Only flip flags here; schedule at most one surface paint per frame budget pulse.
 */
function pushHudToHoloScreens(hud) {
  hudRev += 1;
  const payload = hud ? { ...hud, _rev: hudRev, expId: hud.experiment?.id } : null;
  lastHudSnapshot = payload;
  // dataHtml filled lazily inside the paint job for the active station only.
  lastHudDataHtml = '';

  const activeId = hud?.menuOpen && hud.station?.id ? hud.station.id : null;
  const runningHere = !!(
    activeId
    && hud?.running
    && hud.experiment
  );

  // Physical tabletop sliders track the active experiment (not content-screen canvas).
  syncDeskSlidersFromHud(payload);

  // ── Cheap flag pass (no canvas, no formatData) ──
  Object.entries(holos).forEach(([id, h]) => {
    if (!h?.userData) return;
    const isActive = activeId === id;
    const wasActive = !!h.userData.active;
    h.userData.active = isActive;
    if (!isActive && wasActive) {
      // Leaving this terminal: drop binding only. Do NOT force a full idle redraw
      // (setMaximized/draw would hitch on switch).
      h.userData.boundHud = null;
      h.userData.boundDataHtml = '';
      h.userData._selectorPaintSig = '';
      h.userData.maximized = false;
      if (holoFsState.open && holoFsState.stationId === id) {
        labFrameScheduler.schedule('hud:close-fs', () => closeHoloFullscreen(), { priority: 110 });
      }
    }
  });

  Object.entries(stationDisplays).forEach(([id, d]) => {
    if (!d?.userData) return;
    const want = runningHere && id === activeId;
    if (!want && (d.userData.present || d.userData.active)) {
      // Hide without painting dense experiment chrome.
      if (d.userData) d.userData.maximized = false;
      d.userData.setPresent?.(false);
      d.userData.boundHud = null;
      d.userData.boundDataHtml = '';
      d.userData._contentExpId = null;
      labFrameScheduler.cancel?.(`hud:display-full:${id}`);
      labFrameScheduler.cancel?.(`hud:display-shell:${id}`);
    } else if (want && !d.userData.present) {
      // Show blank panel immediately (visibility only) — content paints next pulses.
      d.userData.setPresent?.(true);
    }
  });

  if (!activeId || !payload) return;

  // ── Tabletop selector: paint only when menu/exp chrome actually changes ──
  labFrameScheduler.schedule(`hud:selector:${activeId}`, () => {
    const h = holos[activeId];
    const snap = lastHudSnapshot;
    if (!h?.userData || !snap) return;
    if (snap.station?.id !== activeId) return;
    const sig = [
      snap.running ? 1 : 0,
      snap.expId || '',
      snap.stepIndex ?? '',
      snap.menuOpen ? 1 : 0,
    ].join('|');
    if (h.userData._selectorPaintSig === sig) return;
    h.userData._selectorPaintSig = sig;
    lastHudDataHtml = '';
    h.userData.setHud?.(snap, '');
  }, { priority: 100, soft: false });

  // ── Content display: direct layout on running experiment ──
  if (runningHere) {
    labFrameScheduler.cancel(`hud:display-shell:${activeId}`);
    const paintFull = () => {
      const d = stationDisplays[activeId];
      const snap = lastHudSnapshot;
      if (!d?.userData || !snap?.running || snap.station?.id !== activeId || !snap.experiment) return;
      d.userData.setPresent?.(true);
      const dataHtml = formatData(snap.station.id, snap.experiment.id, snap.data);
      lastHudDataHtml = dataHtml;
      d.userData.setHud?.(snap, dataHtml);
    };
    labFrameScheduler.schedule(
      `hud:display-full:${activeId}`,
      paintFull,
      { priority: 85, soft: false },
    );
  }

  // Fullscreen overlay — never paint inline on switch.
  if (holoFsState.open) {
    if (!hud?.menuOpen || !hud?.running || hud.station?.id !== holoFsState.stationId) {
      labFrameScheduler.schedule('hud:close-fs', () => closeHoloFullscreen(), { priority: 110 });
    } else {
      labFrameScheduler.schedule('hud:fs-paint', () => paintHoloFs(), { priority: 60 });
    }
  }
}

/** Paint tabletop experiment cards immediately after power-on (no budget wait). */
function forceSelectorMenuPaint(stationId) {
  const h = holos[stationId];
  const st = STATION_EXPERIMENTS[stationId];
  if (!h?.userData || !st) return;
  hudRev += 1;
  const snap = {
    menuOpen: true,
    station: st,
    experiment: null,
    stepIndex: 0,
    step: null,
    running: false,
    data: {},
    stations: STATION_EXPERIMENTS,
    _rev: hudRev,
    expId: null,
  };
  lastHudSnapshot = snap;
  h.userData.active = true;
  // Bust the selector signature so a later scheduled paint cannot skip.
  h.userData._selectorPaintSig = '';
  try {
    h.userData.setHud?.(snap, '');
    h.userData.draw?.(true, true);
  } catch { /* best-effort */ }
}

function handleHoloScreenAction(pick, stationId) {
  if (!pick?.action || !expManager) return false;
  const t = clock.elapsedTime;
  switch (pick.action) {
    case 'close':
      // × button: keep this microtask under ~1ms so look/WASD stay live.
      closeHoloFullscreen();
      if (typeof expManager.closeStationUi === 'function') {
        expManager.closeStationUi();
      } else if (expManager.state?.running) {
        expManager.exitExperiment();
        expManager.closeMenu();
      } else {
        expManager.closeMenu();
      }
      return true;
    case 'maximize': {
      // Maximize = fill the entire browser window (not 3D scale)
      const sid = stationId || holoFsState.stationId;
      if (!sid) return false;
      toggleHoloFullscreen(sid);
      return true;
    }
    case 'activate': {
      // Idle tabletop terminal CTA — open the station menu and paint cards now.
      const sid = stationId || pick.stationId;
      if (!sid) return false;
      if (expManager.state?.menuOpen && expManager.state?.stationId === sid) {
        // Already open: still force a card paint if the idle art is stuck.
        forceSelectorMenuPaint(sid);
        return true;
      }
      openStationMenuSafe(sid);
      forceSelectorMenuPaint(sid);
      return true;
    }
    case 'start':
      // Never paint fullscreen canvas on the click frame — startExperimentSafe
      // only queues budget jobs; paint arrives on a later pulse.
      if (pick.expId) {
        markUserIntent();
        startExperimentSafe(pick.expId);
      }
      return true;
    case 'back':
      expManager.exitExperiment();
      return true;
    case 'action':
      expManager.interact({ userData: { role: 'ui_action' } }, t);
      if (holoFsState.open) paintHoloFs();
      return true;
    case 'record':
      expManager.onKey('KeyF', t);
      if (holoFsState.open) paintHoloFs();
      return true;
    case 'hall-scroll-table':
      // Data-table scrolling is owned by wheel / drag handlers, not clicks.
      return true;
    default: {
      // Forward experiment UI actions (hall-*, optics-diff-*, …) without a hard-coded list
      if (typeof pick.action === 'string' && /^[a-z]+-/.test(pick.action)) {
        const ok = expManager.uiAction(pick.action, pick);
        if (ok && holoFsState.open) paintHoloFs();
        return ok;
      }
      return false;
    }
  }
}

function onHudUpdate(hud) {
  // Zustand store update is cheap; all canvas work is scheduled inside pushHudToHoloScreens.
  updateHud(hud);
  pushHudToHoloScreens(hud);
}

const { createExperimentManager } = await import('./experiments/manager.js');
expManager = createExperimentManager({
  equipment,
  catalog: STATION_EXPERIMENTS,
  modules: loadedStationModules,
  onHudUpdate,
  onToast: showToast,
  stationPresence,
  openTiming: labOpenTiming,
  onApparatusGraphChanged: (stationId) => {
    invalidateStationPickables(stationId);
    // Mechanics source rigs strip all shadow casters during construction, so
    // changing between their six experiments cannot change the shadow map.
    // Electro still owns a few moving casters and keeps the explicit refresh.
    if (stationId !== 'mechanics') requestShadowRefresh();
  },
  // GPU preparation is owned by the intent-prediction path. Never compile
  // the whole room from the atomic legacy-handler commit callback: on ANGLE,
  // compileAsync still performs synchronous program setup before yielding.
  onVisualReady: null,
});

// The legacy handlers still own experiment apparatus, but their entry point is
// now guarded by the same transactional contract as a native runtime. The
// adapter deliberately owns no Three resources; station equipment remains the
// source of truth until the new experiment has loaded and passed its commit
// gate. This makes rapid A->B->C selection cancellable without rewriting all
// 21 scientific handlers in one release.
// Keep a larger, still bounded warm set so repeated experiment changes reuse
// prepared GPU resources instead of disposing and compiling the same rigs.
const experimentCacheBudget = runtimeCacheBudget();
const experimentRuntimeCache = createRuntimeCache({
  ...experimentCacheBudget,
  maxWarm: Math.max(experimentCacheBudget.maxWarm, 5),
  budgetBytes: Math.max(experimentCacheBudget.budgetBytes, 384 * 1024 * 1024),
});
const experimentTransition = createTransitionController({
  cache: experimentRuntimeCache,
  prepareContext: {
    renderer,
    camera,
    detachedRoot: new THREE.Group(),
    // Use the real lab scene as Three.js' target scene so shader defines
    // match the first visible render (lights, environment, shadows, etc.).
    // The isolated prepare scene still limits traversal to the incoming rig.
    targetScene: scene,
    // ensureIntentPrepareScene() creates the shared 1x1 target lazily.
    renderTarget: () => intentPrepareTarget,
  },
  prepareScene: () => ensureIntentPrepareScene(),
  createRuntime: async (key, _ctx, signal) => {
    const [stationId, expId] = String(key).split(':');
    await ensureStationLoaded(stationId);
    await ensureExperimentRuntimeLoaded(stationId, expId);
    if (signal?.aborted) {
      const error = new Error('Operation aborted');
      error.name = 'AbortError';
      throw error;
    }
    const stationRuntime = equipment?.[stationId]?.createRuntime?.(expId);
    if (!stationRuntime) {
      throw new Error(`Experiment runtime is not registered: ${stationId}/${expId}`);
    }
    // Every station adapter is real, but its local id is only the experiment
    // id. Wrap it so cache identity, session rollback and cleanup all use the
    // same station-qualified key.
    return createExperimentRuntime({
      id: key,
      prepare: (ctx, prepareSignal) => stationRuntime.prepare(ctx, prepareSignal),
      prepareGpu: (activeRenderer, activeCamera, prepareScene, prepareSignal, targetScene, renderTarget) => (
        stationRuntime.prepareGpu(activeRenderer, activeCamera, prepareScene, prepareSignal, targetScene, renderTarget)
      ),
      mount: (parent) => stationRuntime.mount(parent),
      activate: (initialState) => stationRuntime.activate(initialState),
      fixedUpdate: (dt) => stationRuntime.fixedUpdate?.(dt),
      visualUpdate: (alpha) => stationRuntime.visualUpdate?.(alpha),
      getPickSet: () => stationRuntime.getPickSet(),
      suspend: () => stationRuntime.suspend(),
      unmount: () => stationRuntime.unmount(),
      estimateBytes: () => stationRuntime.estimateBytes(),
      dispose: () => stationRuntime.dispose(),
    });
  },
});

// Shader warm-up is deliberately post-entry work. The room becomes interactive
// first; then this queue compiles one physical experiment at a time in the
// background. It never imports chemistry and it never blocks the boot reveal.
// Warm only electro station experiments per user preference.
const PHYSICS_SHADER_WARMUP_STATIONS = Object.freeze(['electro']);
const PHYSICS_SHADER_WARMUP_KEYS = Object.freeze(
  PHYSICS_SHADER_WARMUP_STATIONS.flatMap((stationId) => (
    LAB_CATALOG[stationId]?.experiments || []
  ).map((experiment) => `${stationId}:${experiment.id}`)),
);
const PHYSICS_SHADER_WARMUP_LABELS = new Map(
  PHYSICS_SHADER_WARMUP_STATIONS.flatMap((stationId) => (
    LAB_CATALOG[stationId]?.experiments || []
  ).map((experiment) => [
    `${stationId}:${experiment.id}`,
    experiment.name || experiment.title || experiment.id,
  ])),
);
const PHYSICS_SHADER_WARMUP_SIGNATURE = [
  'physics-shader-warmup-v1',
  THREE.REVISION,
  JSON.stringify(HIGH_QUALITY_PROFILE),
  JSON.stringify(PHYSICS_SHADER_WARMUP_KEYS),
].join('|');
let shaderWarmupProgress = null;
let shaderWarmupPromise = null;
let shaderWarmupIndicatorTimer = 0;
const shaderWarmupQuery = new URLSearchParams(window.location.search).get('shaderWarmup');
const shaderWarmupResetRequested = shaderWarmupQuery === 'reset' || shaderWarmupQuery === 'force';

function updateShaderWarmupIndicator(progress = {}) {
  let node = document.getElementById('shader-warmup-indicator');
  const shouldShow = progress.state === 'running';
  if (!node && shouldShow) {
    node = document.createElement('div');
    node.id = 'shader-warmup-indicator';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.innerHTML = `
      <span class="shader-warmup-spinner" aria-hidden="true"></span>
      <span data-shader-warmup-label></span>
    `;
    document.body.appendChild(node);
  }
  if (!node) return;

  clearTimeout(shaderWarmupIndicatorTimer);
  const label = node.querySelector('[data-shader-warmup-label]');
  if (progress.state === 'running') {
    const name = PHYSICS_SHADER_WARMUP_LABELS.get(progress.key) || '实验';
    const current = Number.isFinite(progress.index) ? progress.index + 1 : 0;
    const total = Number.isFinite(progress.total) ? progress.total : PHYSICS_SHADER_WARMUP_KEYS.length;
    if (label) label.textContent = `正在编译：${name}（${Math.min(current, total)}/${total}）`;
    node.classList.remove('is-complete');
    node.classList.add('is-running');
    node.classList.add('show');
    node.setAttribute('aria-busy', 'true');
    return;
  }

  // Prewarm finished or inactive: hide the indicator completely.
  node.classList.remove('show', 'is-complete', 'is-running');
  node.setAttribute('aria-busy', 'false');
}

function hideShaderWarmupIndicator() {
  const node = document.getElementById('shader-warmup-indicator');
  if (!node) return;
  clearTimeout(shaderWarmupIndicatorTimer);
  node.classList.remove('show', 'is-complete', 'is-running');
  node.setAttribute('aria-busy', 'false');
}

const shaderWarmup = createShaderWarmupController({
  keys: PHYSICS_SHADER_WARMUP_KEYS,
  signature: PHYSICS_SHADER_WARMUP_SIGNATURE,
  onProgress: (progress) => {
    shaderWarmupProgress = progress;
    updateShaderWarmupIndicator(progress);
  },
  prepare: (key, signal) => experimentTransition.prewarm(key, signal),
  // Keep the compositor and pointer input responsive between expensive
  // compile jobs. A user opening an experiment can cancel this queue and take
  // priority through the normal transition controller.
  yieldBetween: () => new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => setTimeout(resolve, 80), { timeout: 400 });
    } else {
      setTimeout(resolve, 100);
    }
  }),
});

function startBackgroundShaderWarmup({ force = false } = {}) {
  if (webglContextLost || shaderWarmupPromise) return shaderWarmupPromise;
  shaderWarmupPromise = shaderWarmup.run({
    force: force || shaderWarmupResetRequested,
    revalidate: force || shaderWarmupResetRequested,
  })
    .catch((error) => {
      if (error?.name !== 'AbortError') {
        console.warn('[shader-warmup] background run failed', error);
      }
      return shaderWarmup.snapshot();
    })
    .finally(() => {
      shaderWarmupPromise = null;
    });
  return shaderWarmupPromise;
}

async function pauseBackgroundShaderWarmup() {
  const pending = shaderWarmupPromise;
  if (!pending) return;
  shaderWarmup.cancel();
  await pending.catch(() => {});
}

/** Experiments whose GPU geometry + shaders have been prepared (intent or open). */
const preparedExperimentIds = new Set();
/** Default-state signature captured with prepare, keyed by experiment id. */
const preparedExperimentSignatures = new Map();

// Dev/debug: allow measurement scripts to inspect open state without guessing.
// Must be AFTER preparedExperimentIds init (TDZ crash previously killed the whole app).
// Note: measureOpen is attached after pickable helpers are defined (see below).
const labMeasureEnabled = import.meta.env.DEV
  || new URLSearchParams(window.location.search).has('measure');
if (labMeasureEnabled) {
  window.__labDebug = {
    renderer,
    scene,
    camera,
    equipment,
    stationPresence,
    preparedExperimentIds,
    preparedExperimentSignatures,
    openTiming: labOpenTiming,
    scheduler: labFrameScheduler,
    performanceGovernor,
    transition: experimentTransition,
    experimentRuntimeCache,
    shaderWarmup,
    get shaderWarmupStatus() { return shaderWarmupProgress || shaderWarmup.snapshot(); },
    startShaderWarmup: () => startBackgroundShaderWarmup({ force: true }),
    getPerf: () => labPerfSnapshot(),
    get switchFrameMetrics() {
      return {
        active: switchFrameMetrics.active,
        frames: switchFrameMetrics.frames,
        maxFrameMs: switchFrameMetrics.maxFrameMs,
        stages: { ...switchFrameMetrics.stages },
      };
    },
    get rendererInfo() {
      return {
        memory: { ...renderer.info.memory },
        render: { ...renderer.info.render },
        programs: renderer.info.programs?.length || 0,
        dpr: renderer.getPixelRatio?.() || window.devicePixelRatio || 1,
        quality: { ...HIGH_QUALITY_PROFILE },
      };
    },
    get performance() {
      return performanceGovernor.getSnapshot();
    },
    get memory() {
      return globalThis.performance?.memory
        ? { ...globalThis.performance.memory }
        : null;
    },
    get geoGpuReady() { return !!equipment?.optics?.geoGpuReady; },
    get hot() { return stationPresence?.getHotStation?.() || null; },
    openStationMenu: (sid) => openStationMenuSafe(sid),
    prewarmExperiment: (sid, eid) => beginExperimentIntentPrewarm(sid, eid),
    get intentPrewarm() {
      return {
        focusedKey: focusedExperimentKey,
        activeKey: activeIntentPrewarm?.key || null,
        pending: [...intentPrewarmPromises.keys()],
      };
    },
    startExperiment: (id) => startExperimentSafe(id),
    getExpManager: () => expManager,
  };
}

// Long-task observer feeds measure:perf / gate scripts.
try {
  if (globalThis.PerformanceObserver) {
    const longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > labPerfStats.longTaskMax) {
          labPerfStats.longTaskMax = Number(entry.duration.toFixed(2));
        }
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  }
} catch { /* WebKit / Tauri may lack longtask */ }

/**
 * Light prepare bookkeeping only — never runs station GPU prewarm maps.
 * GPU readiness is owned by createTransitionController + intent prewarm
 * (compileAsync / 1×1 RT). Kept for bridge / measure API compatibility.
 *
 * @param {string} expId
 * @param {string} [stationId]
 * @param {{ force?: boolean, heavy?: boolean }} [opts]
 */
function prepareExperiment(expId, stationId, opts = {}) {
  if (!expId) return;
  let sid = stationId || expManager?.state?.stationId || null;
  if (!sid) {
    for (const [id, st] of Object.entries(STATION_EXPERIMENTS)) {
      if (st.experiments?.some((e) => e.id === expId)) {
        sid = id;
        break;
      }
    }
  }
  const warmSignature = sid ? JSON.stringify(warmInitData(sid, expId)) : '';
  if (!opts.force && preparedExperimentIds.has(expId)
    && preparedExperimentSignatures.get(expId) === warmSignature) return;
  // No GPU work here — open/intent paths own compileAsync / 1×1 present.
}

/** Force every floating content display back to hidden (no experiment selected). */
function hideAllContentDisplays() {
  Object.values(stationDisplays).forEach((d) => {
    if (!d?.userData) return;
    d.userData.setMaximized?.(false);
    d.userData.setHud?.(null, '');
    d.userData.setPresent?.(false);
    d.visible = false;
    d.userData.present = false;
    d.userData.active = false;
  });
  Object.values(deskSliderPanels).forEach((p) => {
    p?.userData?.setPresent?.(false);
    if (p?.userData) p.userData._deskSig = '';
  });
}
/** Map experiment id → station equipment setMode argument. */
const EXP_MODE_BY_ID = Object.freeze({
  'free-fall': 'free-fall',
  'inclined-plane': 'inclined-plane',
  pendulum: 'pendulum',
  collision: 'collision',
  projectile: 'projectile',
  viscosity: 'viscosity',
  hall_effect: 'hall',
  hall_carrier_demo: 'hall-demo',
  electric_field: 'electric-field',
  faraday_induction: 'faraday',
  induced_electric_field: 'induced-e',
  multi_slit_diffraction: 'diffraction',
  reflection: 'geometric',
  refraction: 'geometric',
  dispersion: 'geometric',
  lens: 'geometric',
  calorimetry: 'calorimetry',
  convection: 'convection',
  'heat-conduction': 'heat-conduction',
  'ideal-gas': 'ideal-gas',
  'thermal-expansion': 'thermal-expansion',
});

// Keep the first paint behind the loader until the shell has presented a
// representative frame. Avoids a full-size first render blocking bootstrap.
let bootSuspendRender = true;
/** Cache of experiment initData used by intent prepare / open signatures. */
const warmDataCache = new Map();

/**
 * Authoritative first-open simulation state (same as startExperiment).
 * Keeps field-line signatures and dense HUD branches aligned with runtime.
 */
function warmInitData(stationId, expId) {
  const key = `${stationId}:${expId}`;
  if (warmDataCache.has(key)) return warmDataCache.get(key);
  let data = {};
  try {
    const mod = loadedStationModules[stationId];
    if (mod?.createHandlers) {
      const h = mod.createHandlers({
        state: { running: false, expId: null, data: {}, stepIndex: 0 },
        equipment: {},
        toast() {},
        pushHud() {},
        advanceStep() {},
        setStep() {},
        currentStep: () => null,
        currentExp: () => null,
        currentStation: () => null,
      });
      data = h?.initData?.(expId) || {};
    }
  } catch {
    data = {};
  }
  if (!data || typeof data !== 'object') data = {};
  // Mechanics catalog still carries defaults on the experiment card.
  const exp = STATION_EXPERIMENTS[stationId]?.experiments?.find((e) => e.id === expId);
  if (exp?.defaults && !data.params) {
    data = {
      params: { ...exp.defaults },
      readouts: Array.isArray(data.readouts) ? data.readouts : [],
      paused: false,
      sourceTime: 0,
      ...data,
    };
  }
  warmDataCache.set(key, data);
  return data;
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'gauss') {
  const previewParams = new URLSearchParams(window.location.search);
  void openStationMenuSafe('electro')
    .then(() => console.log('[Lab] Electro station clicked and loading'))
    .catch(err => console.error('[Lab] Electro open failed:', err));
  void startExperimentSafe('gauss_theorem');
  camera.position.set(-4.0, 1.52, 3.55);
  camera.lookAt(-4.0, 1.18, 2.55);
  if (previewParams.get('fullscreen') === '1') {
    requestAnimationFrame(() => openHoloFullscreen('electro'));
  }
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'electric-field') {
  void openStationMenuSafe('electro')
    .then(() => console.log('[Lab] Electro station clicked and loading'))
    .catch(err => console.error('[Lab] Electro open failed:', err));
  void startExperimentSafe('electric_field');
  camera.position.set(-4.0, 1.45, 3.65);
  camera.lookAt(-4.0, 1.12, 2.55);
  if (new URLSearchParams(window.location.search).get('fullscreen') === '1') {
    requestAnimationFrame(() => openHoloFullscreen('electro'));
  }
}

// Development-only visual QA shortcut for the migrated Faraday apparatus.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'faraday') {
  void openStationMenuSafe('electro')
    .then(() => console.log('[Lab] Electro station clicked and loading'))
    .catch(err => console.error('[Lab] Electro open failed:', err));
  void startExperimentSafe('faraday_induction');
  camera.position.set(-3.2, 1.55, 4.0);
  camera.lookAt(-4.0, 1.14, 2.55);
  if (new URLSearchParams(window.location.search).get('fullscreen') === '1') {
    requestAnimationFrame(() => openHoloFullscreen('electro'));
  }
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'induced-e') {
  void openStationMenuSafe('electro')
    .then(() => console.log('[Lab] Electro station clicked and loading'))
    .catch(err => console.error('[Lab] Electro open failed:', err));
  void startExperimentSafe('induced_electric_field');
  camera.position.set(-3.4, 1.75, 3.95);
  camera.lookAt(-4.0, 1.2, 2.55);
  if (new URLSearchParams(window.location.search).get('fullscreen') === '1') {
    requestAnimationFrame(() => openHoloFullscreen('electro'));
  }
}

// Development-only visual QA shortcut for the reconstructed source model.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'hall') {
  const previewParams = new URLSearchParams(window.location.search);
  void openStationMenuSafe('electro')
    .then(() => console.log('[Lab] Electro station clicked and loading'))
    .catch(err => console.error('[Lab] Electro open failed:', err));
  void startExperimentSafe('hall_effect');
  if (previewParams.get('view') === 'terminals') {
    camera.position.set(-4.56, 1.72, 3.08);
    camera.lookAt(-4.43, 1.02, 2.56);
  } else {
    camera.position.set(-4.0, 1.45, 3.65);
    camera.lookAt(-4.0, 1.12, 2.55);
  }
  if (previewParams.get('wiring') === 'helmholtz') {
    expManager.state.data.wires = [
      ['out_red', 'hh_red'],
      ['out_black', 'hh_black'],
    ];
    expManager.update(0, 0);
  } else if (previewParams.get('wiring') === 'helmholtz-reversed') {
    expManager.state.data.wires = [
      ['out_red', 'hh_black'],
      ['out_black', 'hh_red'],
    ];
    expManager.update(0, 0);
  } else if (previewParams.get('wiring') === 'solenoid') {
    expManager.state.data.wires = [
      ['out_red', 'sol_red'],
      ['out_black', 'sol_black'],
    ];
    expManager.update(0, 0);
  } else if (previewParams.get('wiring') === 'reversed') {
    expManager.state.data.wires = [
      ['out_red', 'sol_black'],
      ['out_black', 'sol_red'],
    ];
    expManager.update(0, 0);
  }
  if (previewParams.get('fullscreen') === '1') {
    requestAnimationFrame(() => openHoloFullscreen('electro'));
  }
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'hall-demo') {
  const previewParams = new URLSearchParams(window.location.search);
  void openStationMenuSafe('electro')
    .then(() => console.log('[Lab] Electro station clicked and loading'))
    .catch(err => console.error('[Lab] Electro open failed:', err));
  void startExperimentSafe('hall_carrier_demo');
  if (previewParams.get('screen') === '1') {
    camera.position.set(-4.1, 1.72, 2.6);
    camera.lookAt(-5.42, 1.72, 2.6);
  } else {
    camera.position.set(-4.0, 1.45, 3.65);
    camera.lookAt(-4.0, 1.13, 2.55);
  }
  if (previewParams.get('fullscreen') === '1') {
    requestAnimationFrame(() => openHoloFullscreen('electro'));
  }
}

// DOM panel kept as accessibility fallback (hidden); wire buttons if re-enabled
document.getElementById('exp-close')?.addEventListener('click', (e) => {
  e.stopPropagation();
  expManager.closeMenu();
});
document.getElementById('exp-back')?.addEventListener('click', (e) => {
  e.stopPropagation();
  expManager.exitExperiment();
});
document.getElementById('exp-action')?.addEventListener('click', (e) => {
  e.stopPropagation();
  expManager.interact({ userData: { role: 'ui_action' } }, clock.elapsedTime);
});
document.getElementById('exp-record')?.addEventListener('click', (e) => {
  e.stopPropagation();
  expManager.onKey('KeyF', clock.elapsedTime);
});

// Raycasting interaction
const raycaster = new THREE.Raycaster();
// Used for wheel picking while the pointer is unlocked. PointerLockControls
// keeps the normal ray at the crosshair, but a regular cursor needs its own
// ray based on the wheel event's client coordinates.
const wheelRaycaster = new THREE.Raycaster();
/** UI always raycastable (holos, displays, desk sliders, boards). */
const uiInteractables = [];
/** UI meshes/sprites — collected once at boot (not re-walked on every hot switch). */
const uiSurfaces = [];
/** Per-station interactables; only the hot station is merged into focus picks. */
const stationInteractables = Object.create(null);
/** Per-station mesh/sprite caches — invalidate only when setMode changes the graph. */
const stationSurfaceCache = Object.create(null);
/** Live focus list rebuilt when presence changes. */
const interactables = [];
/** AR surface list — room + hot station only (never full megascene). */
const raycastSurfaces = [];
/** sid → dirty; next assemble will re-walk that station root only. */
const stationPickableDirty = Object.create(null);

function collectFromRoot(root, intoInteractive, intoSurfaces) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.userData && obj.userData.interactive) intoInteractive.push(obj);
    if (intoSurfaces && (obj.isMesh || obj.isSprite)) intoSurfaces.push(obj);
  });
}

/**
 * Re-walk one station's attached graph into pick caches.
 * Called after setMode / showcase changes parented apparatus (not on every setHot).
 * @param {string} sid
 */
function rebuildStationPickables(sid) {
  if (!sid || !stationScenes[sid]?.root) return;
  const t0 = performance.now();
  const list = [];
  const surfaces = [];
  collectFromRoot(stationScenes[sid].root, list, surfaces);
  stationInteractables[sid] = list;
  stationSurfaceCache[sid] = surfaces;
  stationPickableDirty[sid] = false;
  const dt = performance.now() - t0;
  if (dt >= 4) {
    console.log(`[open-trace] rebuildStationPickables ${sid} nI=${list.length} nS=${surfaces.length} dt=${dt.toFixed(1)}ms`);
  }
}

/**
 * Mark a station pick cache stale after apparatus mount/detach.
 * Hot-station reassemble is O(cache) unless dirty forces a single-station walk.
 * @param {string} sid
 */
function invalidateStationPickables(sid) {
  if (!sid) return;
  stationPickableDirty[sid] = true;
  stationSurfaceCache[sid] = null;
  // If this station is currently hot, reassemble focus lists now so the next
  // frame's hover/pick sees the newly parented apparatus.
  if (stationPresence?.getHotStation?.() === sid) {
    assembleInteractablesFromCache();
  }
}

/**
 * Swap which station is in the live focus lists — no tree walk when caches warm.
 */
function assembleInteractablesFromCache() {
  const t0 = performance.now();
  interactables.length = 0;
  raycastSurfaces.length = 0;
  for (let i = 0; i < uiInteractables.length; i += 1) {
    interactables.push(uiInteractables[i]);
  }
  for (let i = 0; i < uiSurfaces.length; i += 1) {
    raycastSurfaces.push(uiSurfaces[i]);
  }
  const hot = stationPresence?.getHotStation?.() || null;
  if (hot && stationScenes[hot]?.root) {
    if (stationPickableDirty[hot] || !stationSurfaceCache[hot]) {
      rebuildStationPickables(hot);
    }
    const stList = stationInteractables[hot] || [];
    for (let i = 0; i < stList.length; i += 1) interactables.push(stList[i]);
    const surfaces = stationSurfaceCache[hot] || [];
    for (let i = 0; i < surfaces.length; i += 1) raycastSurfaces.push(surfaces[i]);
  }
  const dt = performance.now() - t0;
  if (dt >= 4) {
    console.log(`[open-trace] assembleInteractables hot=${hot || 'null'} dt=${dt.toFixed(1)}ms`);
  }
}

/** @deprecated name kept for call sites — now cache-first. */
function rebuildInteractables() {
  assembleInteractablesFromCache();
}

function collectInteractables() {
  uiInteractables.length = 0;
  uiSurfaces.length = 0;
  for (const id of Object.keys(stationScenes)) {
    stationInteractables[id] = [];
    stationSurfaceCache[id] = null;
    stationPickableDirty[id] = true;
  }

  // Partition: anything under a station root → that station; else → UI/room.
  const stationRoots = new Map();
  Object.entries(stationScenes).forEach(([id, st]) => {
    if (st?.root) stationRoots.set(st.root, id);
  });

  scene.traverse((obj) => {
    if (!(obj.userData && obj.userData.interactive)) return;
    let cur = obj;
    let sid = null;
    while (cur) {
      if (stationRoots.has(cur)) {
        sid = stationRoots.get(cur);
        break;
      }
      cur = cur.parent;
    }
    if (sid) {
      if (!stationInteractables[sid]) stationInteractables[sid] = [];
      stationInteractables[sid].push(obj);
    } else {
      uiInteractables.push(obj);
    }
  });

  // UI surfaces once (holos / displays / boards) — never re-walk on setHot.
  for (let i = 0; i < uiInteractables.length; i += 1) {
    const o = uiInteractables[i];
    if (o.isMesh || o.isSprite) uiSurfaces.push(o);
    else collectFromRoot(o, [], uiSurfaces);
  }

  // Seed per-station surface caches for currently attached showcase graphs.
  for (const id of Object.keys(stationScenes)) {
    rebuildStationPickables(id);
  }
  assembleInteractablesFromCache();
}

// Presence changes require a rebuilt focus list (hot station only) — cache swap.
{
  const rawSetHot = stationPresence.setHotStation.bind(stationPresence);
  stationPresence.setHotStation = (id) => {
    const prev = stationPresence.getHotStation();
    const result = rawSetHot(id);
    // Same hot id: resume path only — skip pick reassemble (first-open hitch).
    if (result !== prev) assembleInteractablesFromCache();
    return result;
  };
  const rawCold = stationPresence.coldBootAll.bind(stationPresence);
  stationPresence.coldBootAll = () => {
    rawCold();
    // Showcase modes may remount idle apparatus — mark all dirty once at cold boot.
    for (const id of Object.keys(stationScenes)) {
      stationPickableDirty[id] = true;
      stationSurfaceCache[id] = null;
    }
    assembleInteractablesFromCache();
  };
}
collectInteractables();

// Wire measureOpen after pick helpers exist (DEV or explicit measurement URL).
if (labMeasureEnabled && window.__labDebug) {
  /**
   * Reproducible open timing for Playwright / console.
   * @param {{ stationId: string, expId: string, settleMs?: number, timeoutMs?: number, openMenu?: boolean }} opts
   */
  window.__labDebug.measureOpen = async (opts = {}) => {
    const stationId = opts.stationId || expManager?.state?.stationId;
    const expId = opts.expId;
    if (!stationId || !expId) {
      return { error: 'need stationId + expId' };
    }
    const settleMs = Number.isFinite(opts.settleMs) ? opts.settleMs : 200;
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 5000;
    const openMenu = opts.openMenu !== false;
    const prewarm = opts.prewarm === true;

    // Opening a menu intentionally starts an independent transaction. When
    // openMenu=false, keep the current experiment alive so startExperiment
    // measures the real same-station card switch and records prevExpId.
    if (expManager?.state?.running && openMenu) {
      expManager.exitExperiment?.();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    // Fresh long-task / frame-gap capture for this measurement window.
    const frameGaps = [];
    let lastFrame = performance.now();
    let gapRaf = 0;
    const tickGap = (now) => {
      const gap = now - lastFrame;
      if (gap >= 32) frameGaps.push({ gap: Math.round(gap), t: Math.round(now) });
      lastFrame = now;
      gapRaf = requestAnimationFrame(tickGap);
    };
    gapRaf = requestAnimationFrame(tickGap);

    const longTasks = [];
    let po = null;
    try {
      po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          longTasks.push({ duration: Math.round(e.duration), start: Math.round(e.startTime) });
        }
      });
      // buffered:false — prior longtasks must not pollute open metrics.
      po.observe({ type: 'longtask', buffered: false });
    } catch { /* ignore */ }

    labOpenTiming.clear();
    // Drop buffered longtasks so prior work does not pollute open metrics.
    try {
      performance.clearMeasures?.();
      performance.clearMarks?.();
    } catch { /* ignore */ }
    longTasks.length = 0;
    frameGaps.length = 0;
    lastFrame = performance.now();

    let menuSession = null;
    let menuWallMs = 0;
    let prewarmMs = 0;
    if (openMenu) {
      const menuT0 = performance.now();
      await openStationMenuSafe(stationId);
      menuSession = labOpenTiming.getLast();
      // A card cannot be clicked in the same JavaScript task as opening its
      // menu.  Let the menu get its real first paint, then start a clean
      // measurement window for the experiment-card switch itself.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      menuWallMs = performance.now() - menuT0;
      longTasks.length = 0;
      frameGaps.length = 0;
      lastFrame = performance.now();
    }
    if (prewarm) {
      const prewarmT0 = performance.now();
      await beginExperimentIntentPrewarm(stationId, expId);
      prewarmMs = performance.now() - prewarmT0;
      longTasks.length = 0;
      frameGaps.length = 0;
      lastFrame = performance.now();
    }
    const wall0 = performance.now();
    const openPromise = startExperimentSafe(expId);
    const clickMs = performance.now() - wall0;
    const openOutcome = await openPromise;
    const wallMs = performance.now() - wall0;
    labPerfStats.switchSamples.push(Number(wallMs.toFixed(2)));
    if (window.__labDebug) Object.assign(window.__labDebug, labPerfSnapshot());
    const openResult = {
      ok: !!openOutcome,
      sessionId: experimentTransition.sessionId,
    };

    // Settle when the open chain is done (exp:switch*), not while progressive
    // rays / fringe paints keep the general queue non-empty.
    const settled = await labOpenTiming.waitSettled({
      scheduler: {
        pending: () => {
          const q = labFrameScheduler._queue || [];
          let n = 0;
          for (let i = 0; i < q.length; i += 1) {
            const id = String(q[i]?.id || '');
            if (id === 'exp:switch' || id.startsWith('exp:switch')) n += 1;
          }
          // Also wait until apparatus reports ready.
          if (!expManager?.state?.data?._apparatusReady) n += 1;
          return n;
        },
        softSwitchActive: () => false,
        switchSession: () => false,
      },
      ready: () => expManager?.state?.stationId === stationId
        && expManager?.state?.expId === expId
        && !!expManager?.state?.running
        && !!expManager?.state?.data?._apparatusReady,
      settleMs: Math.min(settleMs, 80),
      timeoutMs: Math.min(timeoutMs, timeoutMs),
    });
    // One extra settle for progressive optics rays / electro sync.
    await new Promise((r) => setTimeout(r, settleMs));
    // Force-close an in-flight experiment session so reports always include marks.
    if (labOpenTiming.getActive()?.kind === 'experiment') {
      labOpenTiming.end({ phase: 'measure-timeout' });
    }
    const expSessions = labOpenTiming.getSessions().filter((s) => s.kind === 'experiment');
    const lastExp = expSessions[expSessions.length - 1] || null;
    cancelAnimationFrame(gapRaf);
    try { po?.disconnect?.(); } catch { /* ignore */ }

    const gaps = frameGaps.slice().sort((a, b) => b.gap - a.gap);
    // Only count longtasks that started after wall0 (open window).
    const openTasks = longTasks
      .filter((t) => t.start >= wall0 - 16)
      .sort((a, b) => b.duration - a.duration);
    return {
      stationId,
      expId,
      openResult,
      clickMs: Number(clickMs.toFixed(2)),
      wallMs: Number(wallMs.toFixed(2)),
      settled,
      perf: labPerfSnapshot(),
      menuSession,
      menuWallMs: Number(menuWallMs.toFixed(2)),
      prewarm,
      prewarmMs: Number(prewarmMs.toFixed(2)),
      experimentSession: lastExp,
      sessions: labOpenTiming.getSessions(),
      geoGpuReady: !!equipment?.optics?.geoGpuReady,
      hot: stationPresence?.getHotStation?.() || null,
      prepared: preparedExperimentIds.has(expId),
      apparatusReady: !!expManager?.state?.data?._apparatusReady,
      topFrameGaps: gaps.slice(0, 12),
      topLongTasks: openTasks.slice(0, 12),
      maxGap: gaps[0]?.gap || 0,
      maxLongTask: openTasks[0]?.duration || 0,
      switchFrameMetrics: window.__labDebug?.switchFrameMetrics || null,
    };
  };
}

let focusedTarget = null;
let lastFocusHit = null;
let holdE = false;
let holdLMB = false;
let pinchStartTimes = new Map();
// Direct desktop dragging is available before pointer-lock is engaged.  The
// standalone Gauss demo behaves this way, so keep a small pointer gesture
// bridge in the host lab instead of requiring a separate "look" click first.
let gaussPointerDrag = null;
let handTracking = null;
let arInteractionController = null;

// Unlocked desktop drag bridge for the source-style charge/probe interaction.
// Pointer-lock and AR continue to use the normal accumulated movement path.
const unlockedElectroRaycaster = new THREE.Raycaster();
const unlockedElectroPointer = new THREE.Vector2();
let unlockedElectroDrag = null;
let lastElectroPointerEventTime = 0;
// iPad WebKit can emit a compatibility mouse sequence after a completed touch
// pointer sequence. Screen buttons act on pointerdown for immediate feedback,
// so accepting that synthetic mousedown would toggle discrete controls twice.
let lastTouchPointerEventTime = -Infinity;
function isHoloControlPrioritized(pick) {
  if (!pick) return false;
  const action = String(pick.action || '');
  if (action.startsWith('hall-')) return true;
  return false;
}
function isHierarchyVisible(object) {
  let current = object;
  while (current) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

function unlockedElectroPick(event) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  unlockedElectroPointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  unlockedElectroRaycaster.setFromCamera(unlockedElectroPointer, camera);
  const hits = unlockedElectroRaycaster.intersectObjects(interactables, true);
  const livePick = pickLiveElectroChargeHit(hits);
  // Content-screen controls beat apparatus only when the panel is clearly in
  // front. A charge/probe closer on the same ray must win — otherwise aiming a
  // charge that overlaps the floating display "clicks through" to the UI.
  const holoControl = getAimedHoloControl(unlockedElectroRaycaster);
  if (
    holoControl?.target
    && (isHoloControlPrioritized(holoControl.pick) || !apparatusBeatsHolo(livePick, holoControl))
  ) {
    return {
      target: holoControl.target,
      raycaster: unlockedElectroRaycaster,
      holoControl: true,
      pick: holoControl.pick || null,
    };
  }
  // Physical desk sliders (tabletop) — absolute track pick like content screens.
  {
    const presentPanels = Object.values(deskSliderPanels).filter((p) => p?.userData?.present);
    if (presentPanels.length) {
      const deskHits = unlockedElectroRaycaster.intersectObjects(presentPanels, true);
      if (deskHits.length) {
        const deskHost = resolveDeskSliderHost(deskHits[0].object);
        if (deskHost?.userData?.present) {
          const pick = deskHost.userData.pickFromRay?.(unlockedElectroRaycaster);
          if (isDeskPanelPick(pick)) {
            const deskPick = {
              target: deskHost,
              hit: { object: deskHost, distance: Number(deskHits[0].distance) || 0 },
            };
            // Same rule: closer charge beats desk panel under the cursor.
            if (!apparatusBeatsHolo(livePick, deskPick)) {
              return {
                target: deskHost,
                raycaster: unlockedElectroRaycaster,
                deskSlider: true,
                pick,
              };
            }
          }
        }
      }
    }
  }
  if (livePick?.target) {
    return { target: livePick.target, raycaster: unlockedElectroRaycaster };
  }
  // Invisible apparatus from other electro modes still raycasts in Three.js,
  // so only accept targets that belong to a currently visible hierarchy.
  const preferredRoles = [
    'electric_charge', 'electric_probe',
    'gauss_charge', 'faraday_rod', 'induced_e_probe',
    'geo_source', 'geo_optic', 'geo_sample', 'geo_slit',
    'diff_source', 'diff_slit', 'diff_screen',
    'thermo_hot_beaker', 'thermo_cold_beaker',
    'hall_knob_im', 'hall_knob_is', 'hall_knob_zero',
    'hall_probe', 'hall_helmholtz', 'hall_solenoid', 'hall_console',
    'hall_terminal_solenoid', 'hall_terminal_helmholtz', 'hall_terminal_output',
    'desk_param_panel',
    'mechanics_viscosity_ball',
  ];
  const roleSet = new Set(preferredRoles);
  for (const hit of hits) {
    const target = resolveInteractive(hit.object);
    if (target && isHierarchyVisible(target) && roleSet.has(target.userData?.role)) {
      return { target, raycaster: unlockedElectroRaycaster };
    }
  }
  return null;
}
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || controls.isLocked || holoFsState?.open) return;
  if (event.pointerType === 'touch' || event.pointerType === 'pen') {
    lastTouchPointerEventTime = performance.now();
  }
  const picked = unlockedElectroPick(event);
  if (!picked) return;
  // Content-screen / desk-slider UI: route through the normal screen path
  // instead of the apparatus drag bridge.
  if (picked.holoControl || picked.deskSlider || resolveScreenHost(picked.target) || resolveDeskSliderHost(picked.target)) {
    const screenHost = resolveScreenHost(picked.target) || (picked.holoControl ? picked.target : null);
    if (screenHost?.userData) {
      const pickKey = picked.pick?.id || picked.pick?.action || (picked.pick?.expId ? `exp-${picked.pick.expId}` : '');
      screenHost.userData._hoverHitId = pickKey;
      screenHost.userData._hoverHit = picked.pick || null;
      screenHost.userData.draw?.(screenHost.userData.active ?? true, true);
    }
    gaussPointerDrag = { suppressClick: true };
    holdLMB = true;
    resetMouseDragAccum();
    syncMouseDragState();
    tryInteract(picked.raycaster, true, {
      target: picked.target,
      direct: true,
      time: clock.elapsedTime,
      pick: picked.pick || null,
    });
    unlockedElectroDrag = {
      ...picked,
      pointerId: event.pointerId ?? null,
      lastX: Number(event.clientX || 0),
      lastY: Number(event.clientY || 0),
      moved: false,
      screenUi: true,
      deskSlider: !!picked.deskSlider || !!resolveDeskSliderHost(picked.target),
      screenHost,
    };
    if (event.pointerId != null) canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }
  unlockedElectroDrag = {
    ...picked,
    pointerId: event.pointerId ?? null,
    lastX: Number(event.clientX || 0),
    lastY: Number(event.clientY || 0),
    moved: false,
  };
  // A successful apparatus pick owns this gesture even when the pointer
  // happens to release without movement; never fall through to pointer-lock.
  gaussPointerDrag = { suppressClick: true };
  holdLMB = true;
  resetMouseDragAccum();
  syncMouseDragState();
  expManager?.beginManipulation(picked.target, {
    direct: true,
    time: clock.elapsedTime,
    raycaster: picked.raycaster,
    pick: picked.pick || null,
  });
  // Keep the gesture routed to the canvas after the initial hit. Without an
  // explicit capture, moving off the tiny charge hit volume can stop emitting
  // pointermove events in unlocked desktop mode.
  if (event.pointerId != null) canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});
window.addEventListener('pointermove', (event) => {
  if (!unlockedElectroDrag) return;
  if (
    unlockedElectroDrag.pointerId != null
    && event.pointerId != null
    && event.pointerId !== unlockedElectroDrag.pointerId
  ) return;
  lastElectroPointerEventTime = performance.now();
  const fallbackDx = Number(event.clientX || 0) - unlockedElectroDrag.lastX;
  const fallbackDy = Number(event.clientY || 0) - unlockedElectroDrag.lastY;
  const dx = Number.isFinite(event.movementX) && event.movementX !== 0 ? event.movementX : fallbackDx;
  const dy = Number.isFinite(event.movementY) && event.movementY !== 0 ? event.movementY : fallbackDy;
  if (Math.hypot(dx, dy) >= 3) unlockedElectroDrag.moved = true;
  unlockedElectroDrag.lastX = Number(event.clientX || unlockedElectroDrag.lastX);
  unlockedElectroDrag.lastY = Number(event.clientY || unlockedElectroDrag.lastY);
  accumulateMouseDrag(dx, dy, { shiftKey: !!event.shiftKey });
  // Keep the ray under the cursor for absolute screen, desk slider, and 3D apparatus tracking.
  const rect = canvas.getBoundingClientRect();
  if (rect.width >= 1 && rect.height >= 1) {
    unlockedElectroPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    unlockedElectroRaycaster.setFromCamera(unlockedElectroPointer, camera);
  }
  if (unlockedElectroDrag.screenHost?.userData) {
    const screenHost = unlockedElectroDrag.screenHost;
    const livePick = screenHost.userData.pickFromRay ? screenHost.userData.pickFromRay(unlockedElectroRaycaster) : null;
    const pickKey = livePick?.id || livePick?.action || (livePick?.expId ? `exp-${livePick.expId}` : '');
    if (screenHost.userData._hoverHitId !== pickKey) {
      screenHost.userData._hoverHitId = pickKey;
      screenHost.userData._hoverHit = livePick;
      screenHost.userData.draw?.(screenHost.userData.active ?? true, true);
    }
  }
  expManager?.updateManipulation(unlockedElectroDrag.target, {
    dt: 1 / 60,
    time: clock.elapsedTime,
    totalX: equipment?.electro?.mouseDrag?.movementX || 0,
    totalY: equipment?.electro?.mouseDrag?.movementY || 0,
    shiftKey: !!event.shiftKey || !!equipment?.electro?.mouseDrag?.shiftKey,
    raycaster: unlockedElectroRaycaster,
    dragged: true,
  });
  gaussPointerDrag.suppressClick = true;
});
function finishUnlockedElectroDrag(event, cancelled = false) {
  if (!unlockedElectroDrag) return;
  if (
    unlockedElectroDrag.pointerId != null
    && event?.pointerId != null
    && event.pointerId !== unlockedElectroDrag.pointerId
  ) return;
  if (unlockedElectroDrag.screenHost?.userData) {
    const screenHost = unlockedElectroDrag.screenHost;
    setTimeout(() => {
      if (screenHost?.userData) {
        screenHost.userData._hoverHitId = '';
        screenHost.userData._hoverHit = null;
        screenHost.userData.draw?.(screenHost.userData.active ?? true, true);
      }
    }, 120);
  }
  expManager?.endManipulation(unlockedElectroDrag.target, {
    time: clock.elapsedTime,
    cancelled,
    dragged: !!unlockedElectroDrag.moved,
  });
  if (event?.pointerId != null) canvas.releasePointerCapture?.(event.pointerId);
  unlockedElectroDrag = null;
  holdLMB = false;
  syncMouseDragState();
}
window.addEventListener('pointerup', (event) => {
  if (event.button !== 0) return;
  if (event.pointerType === 'touch' || event.pointerType === 'pen') {
    lastTouchPointerEventTime = performance.now();
  }
  finishUnlockedElectroDrag(event);
});
window.addEventListener('pointercancel', (event) => {
  if (event.pointerType === 'touch' || event.pointerType === 'pen') {
    lastTouchPointerEventTime = performance.now();
  }
  finishUnlockedElectroDrag(event, true);
});

// Some desktop automation shells (and older embedded WebViews) expose the
// legacy mouse stream without forwarding pointermove. Mirror the same bridge
// for that path; ignore synthetic mouse events that immediately follow a
// native pointer event so movement is not applied twice.
canvas.addEventListener('mousedown', (event) => {
  if (performance.now() - lastTouchPointerEventTime < 1000) {
    event.preventDefault();
    return;
  }
  if (unlockedElectroDrag || event.button !== 0 || controls.isLocked || holoFsState?.open) return;
  const picked = unlockedElectroPick(event);
  if (!picked) return;
  if (picked.holoControl || resolveScreenHost(picked.target)) {
    gaussPointerDrag = { suppressClick: true };
    holdLMB = true;
    resetMouseDragAccum();
    syncMouseDragState();
    tryInteract(picked.raycaster, true, {
      target: picked.target,
      direct: true,
      time: clock.elapsedTime,
    });
    unlockedElectroDrag = {
      ...picked,
      lastX: Number(event.clientX || 0),
      lastY: Number(event.clientY || 0),
      screenUi: true,
    };
    if (event.pointerId != null) canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }
  unlockedElectroDrag = { ...picked, lastX: Number(event.clientX || 0), lastY: Number(event.clientY || 0) };
  gaussPointerDrag = { suppressClick: true };
  holdLMB = true;
  resetMouseDragAccum();
  syncMouseDragState();
  expManager?.beginManipulation(picked.target, { direct: true, time: clock.elapsedTime });
  if (event.pointerId != null) canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});
window.addEventListener('mousemove', (event) => {
  if (!unlockedElectroDrag || performance.now() - lastElectroPointerEventTime < 8) return;
  const fallbackDx = Number(event.clientX || 0) - unlockedElectroDrag.lastX;
  const fallbackDy = Number(event.clientY || 0) - unlockedElectroDrag.lastY;
  const dx = Number.isFinite(event.movementX) && event.movementX !== 0 ? event.movementX : fallbackDx;
  const dy = Number.isFinite(event.movementY) && event.movementY !== 0 ? event.movementY : fallbackDy;
  unlockedElectroDrag.lastX = Number(event.clientX || unlockedElectroDrag.lastX);
  unlockedElectroDrag.lastY = Number(event.clientY || unlockedElectroDrag.lastY);
  accumulateMouseDrag(dx, dy, { shiftKey: !!event.shiftKey });
  const rect = canvas.getBoundingClientRect();
  if (rect.width >= 1 && rect.height >= 1) {
    unlockedElectroPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    unlockedElectroRaycaster.setFromCamera(unlockedElectroPointer, camera);
  }
  expManager?.updateManipulation(unlockedElectroDrag.target, {
    dt: 1 / 60,
    time: clock.elapsedTime,
    totalX: equipment?.electro?.mouseDrag?.movementX || 0,
    totalY: equipment?.electro?.mouseDrag?.movementY || 0,
    shiftKey: !!event.shiftKey || !!equipment?.electro?.mouseDrag?.shiftKey,
    raycaster: unlockedElectroRaycaster,
  });
  gaussPointerDrag.suppressClick = true;
});
window.addEventListener('mouseup', (event) => {
  if (!unlockedElectroDrag || event.button !== 0) return;
  expManager?.endManipulation(unlockedElectroDrag.target, { time: clock.elapsedTime });
  unlockedElectroDrag = null;
  holdLMB = false;
  syncMouseDragState();
});

function getFocusHit() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects(interactables, true);
  if (!hits.length) return null;
  return hits[0];
}

function resolveInteractive(obj) {
  return findInteractionHost(obj);
}

/** Climb to the side-blackboard host that owns pick/draw APIs. */
function resolveSideBlackboardHost(obj) {
  return findInteractionHost(obj, (candidate) => (
    isInteractionKind(candidate, INTERACTION_KIND.SIDE_BLACKBOARD)
    && hasInteractionMethod(candidate, 'drawFromRay')
 ));
}

/** Climb to tabletop holo / content-display host that owns pickFromRay. */
function resolveScreenHost(obj) {
  const host = findInteractionHost(obj, (candidate) => (
    isInteractionKind(candidate, INTERACTION_KIND.HOLO_SELECTOR, INTERACTION_KIND.HOLO_DISPLAY)
    && hasInteractionMethod(candidate, 'pickFromRay')
 ));
  if (host) return host;
  // Fallback via station maps if only a child mesh was selected.
  const sid = obj?.userData?.stationId;
  if (!sid) return null;
  if (obj?.userData?.type === 'holo_display' || obj?.userData?.role === 'holo_display') {
    return stationDisplays[sid] || null;
  }
  return holos[sid] || null;
}

/** Climb to physical desk param-slider panel. */
function resolveDeskSliderHost(obj) {
  const host = findInteractionHost(obj, (candidate) => (
    isInteractionKind(candidate, INTERACTION_KIND.DESK_PANEL)
    && hasInteractionMethod(candidate, 'pickFromRay')
 ));
  if (host) return host;
  const sid = obj?.userData?.stationId;
  if (sid && deskSliderPanels[sid]) return deskSliderPanels[sid];
  return null;
}

/** Respect optional per-object maxInteractDist (front boards / formula screen). */
function withinInteractDist(obj, distance) {
  const max = obj?.userData?.maxInteractDist;
  if (max == null || !Number.isFinite(max)) return true;
  return distance <= max;
}

function frontWallTooFarToast() {
  showToast('请走近前墙再操作（约实验室前三分之一区域）');
}

/** Prefer specific apparatus controls over the station root. */
function resolveInteractivePreferred(hits) {
  if (!hits?.length) return null;
  const ROLE_PRI = {
    pendulum_bob: 65,
    spring_mass: 65,
    diff_source: 65,
    diff_slit: 65,
    diff_screen: 65,
    // Base equal priority; sequential identify boosts the required next part below.
    hall_helmholtz: 50,
    hall_solenoid: 50,
    hall_probe: 50,
    hall_console: 50,
    hall_knob_im: 70,
    hall_knob_is: 70,
    hall_knob_zero: 70,
    gauss_charge: 78,
    gauss_surface: 42,
    electric_charge: 80,
    electric_probe: 82,
    faraday_rod: 86,
    induced_e_probe: 88,
    desk_param_panel: 92,
    mechanics_viscosity_ball: 95,
    hall_terminal_solenoid: 80,
    hall_terminal_helmholtz: 80,
    hall_terminal_output: 80,
    formula_board: 45,
    side_blackboard: 46,
    electro: 5,
    holo: 40,
    holo_selector: 40,
    holo_display: 48,
  };
  // Slightly wider band so wall-side holos can compete when gear is close.
  // (Screen-plane aim is handled separately in getAimedHolo — that is the
  // primary fix for "instruments block the hologram".)
  // Prefer first hit that is actually interactable (skip distant formula board etc.)
  // and currently visible (hidden electro modes leave raycast-enabled meshes).
  let nearBase = null;
  for (const hit of hits) {
    const o = resolveInteractive(hit.object);
    if (!o) continue;
    if (!isHierarchyVisible(o)) continue;
    if (!withinInteractDist(o, hit.distance)) continue;
    nearBase = hit.distance;
    break;
  }
  if (nearBase == null) return null;
  const near = nearBase + 0.35;
  // During Hall sequential identify, prefer the required next apparatus so a
  // closer ruler/console in the same view cannot permanently shadow it.
  const identifyNext = (
    expManager?.state?.expId === 'hall_effect'
    && expManager.currentStep?.()?.id === 'identify'
    && expManager.state?.data?.identifyNext
  ) || null;
  let best = null;
  let bestScore = -Infinity;
  for (const hit of hits) {
    if (hit.distance > near) break;
    const o = resolveInteractive(hit.object);
    if (!o) continue;
    if (!isHierarchyVisible(o)) continue;
    if (!withinInteractDist(o, hit.distance)) continue;
    const role = o.userData.role || (o.userData.type === 'holo' ? 'holo' : '');
    let pri = ROLE_PRI[role] ?? 10;
    if (identifyNext && role === identifyNext) pri += 45;
    // closer + higher role priority
    const score = pri * 10 - hit.distance;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

/**
 * Live bench apparatus under the ray for the active electro experiment.
 * These win over empty content-screen glass so gear stays grabable when the
 * floating display sits between the camera and the tabletop.
 * @returns {{ target: object, hit: { object: object, distance: number } } | null}
 */
function pickLiveElectroChargeHit(hits) {
  const expId = expManager?.state?.expId;
  const identifyNext = (
    expId === 'hall_effect'
    && expManager.currentStep?.()?.id === 'identify'
    && expManager.state?.data?.identifyNext
  ) || null;
  const preferredRoles = expId === 'electric_field'
    ? ['electric_charge', 'electric_probe']
    : expId === 'gauss_theorem'
      ? ['gauss_charge', 'electric_charge']
      : expId === 'faraday_induction'
        ? ['faraday_rod']
        : expId === 'induced_electric_field'
          ? ['induced_e_probe']
          : expId === 'hall_effect'
            ? [
              'hall_knob_im', 'hall_knob_is', 'hall_knob_zero',
              'hall_probe', 'hall_helmholtz', 'hall_solenoid',
              ...(expManager.currentStep?.()?.id === 'identify' ? ['hall_console'] : []),
              'hall_terminal_solenoid', 'hall_terminal_helmholtz', 'hall_terminal_output',
            ]
            : expId === 'multi_slit_diffraction'
              ? ['diff_source', 'diff_slit', 'diff_screen']
              : ['reflection', 'refraction', 'dispersion', 'lens'].includes(expId)
                ? ['geo_source', 'geo_optic', 'geo_sample', 'geo_slit']
                : expId === 'calorimetry'
                  ? ['thermo_hot_beaker', 'thermo_cold_beaker']
                  : expId === 'viscosity'
                      ? ['mechanics_viscosity_ball']
                      : null;
  if (!preferredRoles || !hits?.length) return null;
  // Closest matching apparatus wins. Role order alone used to pick a farther
  // source charge over a nearer probe (or keep an oversized probe sphere that
  // merely grazes the ray in front of the content screen).
  const roleSet = new Set(preferredRoles);
  let best = null;
  let expected = null;
  for (let i = 0; i < hits.length; i += 1) {
    const entry = hits[i];
    const target = resolveInteractive(entry.object);
    if (!target || !isHierarchyVisible(target)) continue;
    const role = target.userData?.role;
    if (!roleSet.has(role)) continue;
    // In the sequential Hall introduction, a console hit volume can sit in
    // front of the coils and ruler. Prefer the requested part whenever its
    // own recognition proxy is also under the ray.
    if (role?.includes('label')) {
      return { target, hit: entry };
    }
    if (!best || entry.distance < best.hit.distance) {
      best = { target, hit: entry };
    }
  }
  return expected || best;
}

function pickLiveElectroCharge(hits) {
  return pickLiveElectroChargeHit(hits)?.target || null;
}

/**
 * Prefer floating screens when the crosshair lands on a screen plane.
 * Mesh raycasts often hit table instruments first (they sit closer than the
 * wall-edge projectors), which previously made the holo unusable up close.
 * Content displays are preferred over tabletop selectors when both are aimed.
 */
function getAimedHolo(rc) {
  let best = null;
  let bestDist = Infinity;
  let bestPri = -Infinity;
  const candidates = [
    ...Object.values(stationDisplays).map((d) => ({ screen: d, pri: 2 })),
    ...Object.values(holos).map((h) => ({ screen: h, pri: 1 })),
  ];
  for (const { screen, pri } of candidates) {
    const aim = screen?.userData?.screenAimFromRay?.(rc);
    if (!aim) continue;
    if (aim.distance + 0.05 < bestDist || (Math.abs(aim.distance - bestDist) <= 0.05 && pri > bestPri)) {
      bestDist = aim.distance;
      bestPri = pri;
      best = screen;
    }
  }
  return best;
}

function getAimedHoloControl(rc) {
  let best = null;
  let bestDist = Infinity;
  let bestPri = -Infinity;
  const candidates = [
    ...Object.values(stationDisplays).map((d) => ({ screen: d, pri: 2 })),
    ...Object.values(holos).map((h) => ({ screen: h, pri: 1 })),
  ];
  for (const { screen, pri } of candidates) {
    const isSelector = screen?.userData?.type === 'holo'
      || screen?.userData?.role === 'holo_selector';
    // Idle tabletop selectors must stay aimable so "点击激活" works without
    // pointer-lock. Content displays still require present/active.
    if (!(screen?.userData?.active || screen?.userData?.present || isSelector)) continue;
    const aim = screen.userData.screenAimFromRay?.(rc);
    if (!aim) continue;
    if (aim.distance - 0.05 > bestDist) continue;
    // Only an actual button/card/activate region receives UI priority. Empty
    // active-screen space still obeys the frontmost-surface rule.
    const pick = screen.userData.pickFromRay?.(rc);
    if (!pick) continue;
    if (aim.distance + 0.05 < bestDist || (Math.abs(aim.distance - bestDist) <= 0.05 && pri > bestPri)) {
      bestDist = aim.distance;
      bestPri = pri;
      best = {
        target: screen,
        hit: { object: screen, distance: aim.distance },
        // Preserve the first discrete hit. Re-sampling a gently floating
        // hologram later in the same noisy iPad gesture can miss small keys.
        pick,
      };
    }
  }
  return best;
}

/**
 * Physical tabletop param panel under the ray (same role as getAimedHoloControl
 * for content-screen UI). Desk tracks must beat Faraday rods / Hall knobs that
 * sit further along the same ray — otherwise AR pinch always becomes look /
 * apparatus grab and the control panel is unreachable.
 */
function getAimedDeskSlider(rc) {
  if (!rc) return null;
  const presentPanels = Object.values(deskSliderPanels).filter((p) => p?.userData?.present);
  if (!presentPanels.length) return null;
  const hits = rc.intersectObjects(presentPanels, true);
  if (!hits.length) return null;
  const deskHost = resolveDeskSliderHost(hits[0].object);
  if (!deskHost?.userData?.present) return null;
  const pick = deskHost.userData.pickFromRay?.(rc);
  if (!isDeskPanelPick(pick)) return null;
  return {
    target: deskHost,
    hit: { object: deskHost, distance: Number(hits[0].distance) || 0 },
    pick,
  };
}

const _lastFocusCamPos = new THREE.Vector3();
const _lastFocusCamQuat = new THREE.Quaternion();
let _cachedFocusTarget = undefined;
let _cachedFocusHit = null;

function getFocusTarget(inputRaycaster = raycaster) {
  if (inputRaycaster === raycaster) {
    inputRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const posUnchanged = camera.position.distanceToSquared(_lastFocusCamPos) < 1e-6;
    const quatUnchanged = Math.abs(camera.quaternion.dot(_lastFocusCamQuat)) > 0.999999;
    if (posUnchanged && quatUnchanged && !expManager?.state?.running && _cachedFocusTarget !== undefined) {
      lastFocusHit = _cachedFocusHit;
      return _cachedFocusTarget;
    }
    _lastFocusCamPos.copy(camera.position);
    _lastFocusCamQuat.copy(camera.quaternion);
  }

  const result = _computeFocusTarget(inputRaycaster);
  if (inputRaycaster === raycaster) {
    _cachedFocusTarget = result;
    _cachedFocusHit = lastFocusHit;
  }
  return result;
}

function _computeFocusTarget(inputRaycaster) {
  const hits = inputRaycaster.intersectObjects(interactables, true);
  lastFocusHit = hits[0] || null;

  const livePick = pickLiveElectroChargeHit(hits);
  // Content UI wins only when it is clearly closer than live apparatus.
  // Otherwise aiming a charge that overlaps the floating screen clicks the UI.
  const holoControl = getAimedHoloControl(inputRaycaster);
  if (
    holoControl?.target
    && (isHoloControlPrioritized(holoControl.pick) || !apparatusBeatsHolo(livePick, holoControl))
  ) {
    lastFocusHit = holoControl.hit;
    return holoControl.target;
  }

  // Physical desk sliders (B / x / …) — same distance rule vs apparatus.
  const deskControl = getAimedDeskSlider(inputRaycaster);
  if (deskControl?.target && !apparatusBeatsHolo(livePick, deskControl)) {
    lastFocusHit = deskControl.hit;
    return deskControl.target;
  }

  // Bench apparatus (charges, Faraday rod, Hall knobs, …).
  if (livePick?.target) {
    lastFocusHit = livePick.hit;
    return livePick.target;
  }

  // The Hall sockets are deliberately tiny in the model.  If the mouse ray
  // passes just beside a socket, use the same semantic nearest-port fallback
  // as AR so the port can still be grabbed instead of selecting the console
  // deck behind it.  Keep this scoped to the Hall experiment and to a narrow
  // aim band so ordinary apparatus picking remains frontmost elsewhere.
  // Run before empty-glass holo so terminals remain usable when the panel
  // occludes the bench but the aim is still near a socket.
  if (expManager?.state?.expId === 'hall_effect') {
    const terminal = hallBench.userData.getHallTerminalTarget?.(inputRaycaster, { maxDistance: 0.045 });
    if (terminal?.target) {
      lastFocusHit = terminal.hit;
      return terminal.target;
    }
  }

  // Empty content-screen glass (no button/slider under the ray) must NOT steal
  // focus — otherwise only terminals (nearest-port) remain usable.
  const aimedHolo = getAimedHolo(inputRaycaster);
  if (aimedHolo) {
    const pick = aimedHolo.userData.pickFromRay?.(inputRaycaster);
    if (pick) return aimedHolo;
  }

  if (!hits.length) return null;
  return resolveInteractivePreferred(hits);
}

function getHandFocusInfo(inputRaycaster, handNdc = null) {
  // DOM overlays are visually in front of the 3D scene. Keep their screen
  // rectangles opaque to AR hit testing as well, otherwise a hand placed on
  // the status card can fall through and select the yellow probe behind it.
  if (handCursorOverUi(handNdc)) return { target: null, hit: null };
  const hits = inputRaycaster.intersectObjects(raycastSurfaces, false);
  const terminalFallback = expManager?.state?.expId === 'hall_effect'
    ? hallBench.userData.getHallTerminalTarget?.(inputRaycaster)
    : null;
  const holoControl = getAimedHoloControl(inputRaycaster);
  const deskControl = getAimedDeskSlider(inputRaycaster);
  const livePick = pickLiveElectroChargeHit(
    inputRaycaster.intersectObjects(interactables, true),
  );
  // Distance-aware: closer charge beats holo/desk on the same ray (matches
  // getFocusTarget / unlocked desktop pick).
  let priorityInteraction = null;
  if (
    holoControl?.target
    && (isHoloControlPrioritized(holoControl.pick) || !apparatusBeatsHolo(livePick, holoControl))
  ) {
    priorityInteraction = holoControl;
  } else if (deskControl?.target && !apparatusBeatsHolo(livePick, deskControl)) {
    priorityInteraction = deskControl;
  } else if (livePick?.target) {
    priorityInteraction = { target: livePick.target, hit: livePick.hit };
  } else if (terminalFallback) {
    priorityInteraction = terminalFallback;
  }

  // Empty content-screen glass (no button/slider under the ray) must not be
  // treated as an interactive target for AR, and must not occlude apparatus
  // behind it. Otherwise a pinch on empty glass locks into "manipulating"
  // (look is blocked) and apparatus behind the screen becomes unreachable.
  // Real control picks are already elevated via holoControl priority above.
  const isEmptyHoloGlassHit = (hit) => {
    if (holoControl?.target) return false;
    const target = resolveInteractive(hit?.object);
    if (!target) return false;
    const isDisplay = target.userData?.type === 'holo_display'
      || target.userData?.role === 'holo_display';
    const isSelector = target.userData?.type === 'holo'
      || target.userData?.role === 'holo_selector';
    // Only filter pure display glass when there is no control pick under the ray.
    // holo_selector (menu terminals) must stay interactive even if the ray misses a button.
    return isDisplay && !holoControl?.target;
  };
  const filteredHits = (hits || []).filter((hit) => !isEmptyHoloGlassHit(hit));

  return resolveFrontmostInteraction(filteredHits, {
    resolveInteractive,
    withinInteractDist,
    priorityInteraction,
    // Once the front surface is known to be interactive, match the mouse
    // resolver inside that same shallow apparatus layer so a broad station or
    // console hit box cannot swallow its button/knob/terminal controls.
    preferInteractive: resolveInteractivePreferred,
  });
}

function handCursorOverUi(ndc) {
  if (!ndc) return false;
  // Map NDC through the canvas layout box (not window.inner*), matching the
  // drawing buffer / camera aspect used for picking.
  const rect = canvas.getBoundingClientRect();
  const x = rect.left + (Number(ndc.x) + 1) * 0.5 * rect.width;
  const y = rect.top + (1 - Number(ndc.y)) * 0.5 * rect.height;
  if (![x, y].every(Number.isFinite)) return false;
  return [handToggleEl, arTutorialEl, helpModalWrapEl].some((element) => {
    if (!element || element.getClientRects().length === 0) return false;
    const box = element.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  });
}

function tryInteract(inputRaycaster = raycaster, allowUnlocked = false, directContext = null) {
  if (!allowUnlocked && !controls.isLocked) return false;
  const t = clock.elapsedTime;
  if (!inputRaycaster) return false;
  if (inputRaycaster === raycaster) {
    inputRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  }

  // AR pinch often arrives with a stale/null locked target. Always re-resolve
  // holos from the live ray first so menus/buttons stay clickable.
  const directTarget = directContext?.target || null;

  // ── Desk panel locked by AR pinch / desktop click: handle before holo UI ──
  // A content-screen plane on the same ray used to win and toast "请瞄准控件",
  // so AR pinches on the physical control panel never reached the sliders.
  {
    const directDesk = resolveDeskSliderHost(directTarget);
    if (directDesk?.userData?.present) {
      const pick = (isDeskPanelPick(directContext?.pick) ? directContext.pick : null)
        || directDesk.userData.pickFromRay?.(inputRaycaster);
      if (isDeskActionPick(pick)) {
        expManager.uiAction?.(pick.action, pick.payload || pick.meta || pick || {});
        return true;
      }
      if (pick && isParamSliderAction(pick.action)) {
        expManager.beginManipulation(directDesk, {
          ...(directContext || {}),
          time: directContext?.time ?? t,
          raycaster: inputRaycaster,
          pick,
        });
        return true;
      }
    }
  }

  // ── FAST PATH: hologram UI — but not when a closer charge is under the ray ──
  // Experiment card clicks used to freeze the lab because every press ran
  // intersectObjects(interactables) over the whole station before handling UI.
  // Exception: live apparatus closer than the screen must win (aim charge ≠
  // click the floating panel behind it).
  // Prefer ray-based holo pick over a raw directTarget mesh: AR tip lock often
  // points at a non-UV child; getAimedHoloControl still finds the real card.
  const directScreen = resolveScreenHost(directTarget);
  let aimedHoloControl = getAimedHoloControl(inputRaycaster);
  if (directScreen && !aimedHoloControl?.target) {
    aimedHoloControl = { target: directScreen, hit: { object: directScreen, distance: 0 } };
  }
  if (aimedHoloControl?.target) {
    const probeHits = inputRaycaster.intersectObjects(interactables, true);
    const livePick = pickLiveElectroChargeHit(probeHits);
    if (
      !isHoloControlPrioritized(aimedHoloControl.pick || directContext?.pick)
      && apparatusBeatsHolo(livePick, aimedHoloControl)
    ) {
      aimedHoloControl = null;
    }
  }
  const aimedHoloFast = aimedHoloControl?.target || directScreen || null;

  if (aimedHoloFast) {
    const aimedHolo = aimedHoloFast;
    const sid = aimedHolo.userData.stationId;
    const isDisplay = aimedHolo.userData.type === 'holo_display'
      || aimedHolo.userData.role === 'holo_display';
    const isSelector = aimedHolo.userData.type === 'holo'
      || aimedHolo.userData.role === 'holo_selector';
    const screenLive = !!(aimedHolo.userData.active || aimedHolo.userData.present);
    // The pointer/hand acquisition pass already resolved the exact button.
    // Use that stable result before asking a floating plane to sample again.
    const pick = directContext?.pick
      || aimedHoloControl?.pick
      || aimedHolo.userData.pickFromRay?.(inputRaycaster);
    if (pick) {
      if (isParamSliderAction(pick.action)) {
        expManager.beginManipulation(aimedHolo, {
          ...(directContext || {}),
          time: directContext?.time ?? t,
          raycaster: inputRaycaster,
          pick,
        });
        return true;
      }
      if (pick.action === 'hall-scroll-table' || pick.role === 'scrollable_table' || pick.role === 'scrollable_components') {
        if (directContext) {
          expManager.beginManipulation(aimedHolo, {
            ...directContext,
            time: directContext?.time ?? t,
            raycaster: inputRaycaster,
            pick,
          });
        } else {
          handleHoloScreenAction(pick, sid);
        }
        return true;
      }
      // activate / start / back / menu cards — before any scene raycast
      handleHoloScreenAction(pick, sid);
      return true;
    }
    if (screenLive) {
      if (isDisplay && !directScreen && !aimedHoloControl?.target) {
        // empty content glass → fall through to apparatus
      } else if (!isDisplay) {
        // Selector aimed but UV miss: still activate (AR tip is noisy).
        if (isSelector) {
          handleHoloScreenAction({ action: 'activate', stationId: sid }, sid);
          return true;
        }
        if (!directContext) showToast('请瞄准桌面终端上的实验卡片');
        return !directContext;
      } else {
        if (!directContext) showToast('请瞄准内容屏上的控件');
        return false;
      }
    } else if (isSelector) {
      // Fallback if pickFromRay failed to sample UV but the terminal is aimed.
      handleHoloScreenAction({ action: 'activate', stationId: sid }, sid);
      return true;
    } else if (!isDisplay) {
      expManager.interact(aimedHolo, t);
      return true;
    } else {
      if (!directContext) showToast('请先在桌面终端选择实验');
      return !directContext;
    }
  }

  // ── Desk param panel (tabletop tracks + action chips) ──
  {
    const directDesk = resolveDeskSliderHost(directTarget);
    const deskHost = directDesk || (() => {
      // Prefer an aimed desk panel even when gear sits slightly closer.
      const probeHits = inputRaycaster.intersectObjects(
        Object.values(deskSliderPanels).filter((p) => p?.userData?.present),
        true,
      );
      if (!probeHits.length) return null;
      return resolveDeskSliderHost(probeHits[0].object);
    })();
    if (deskHost?.userData?.present) {
      const pick = deskHost.userData.pickFromRay?.(inputRaycaster)
        || (isDeskPanelPick(directContext?.pick) ? directContext.pick : null);
      if (isDeskActionPick(pick)) {
        expManager.uiAction?.(pick.action, pick.payload || pick.meta || pick || {});
        return true;
      }
      if (pick && isParamSliderAction(pick.action)) {
        expManager.beginManipulation(deskHost, {
          ...(directContext || {}),
          time: directContext?.time ?? t,
          raycaster: inputRaycaster,
          pick,
        });
        return true;
      }
    }
  }

  // ── SLOW PATH: full interactables raycast (apparatus only) ──
  const hits = inputRaycaster.intersectObjects(interactables, true);
  lastFocusHit = hits[0] || null;

  const liveChargeRoles = new Set([
    'electric_charge', 'electric_probe', 'gauss_charge', 'faraday_rod', 'induced_e_probe',
    'hall_knob_im', 'hall_knob_is', 'hall_knob_zero',
    'hall_probe', 'hall_helmholtz', 'hall_solenoid', 'hall_console',
    'hall_terminal_solenoid', 'hall_terminal_helmholtz', 'hall_terminal_output',
    'desk_param_panel',
    'mechanics_viscosity_ball',
  ]);
  const directIsCharge = !!(
    directTarget
    && liveChargeRoles.has(directTarget.userData?.role)
    && isHierarchyVisible(directTarget)
    && !resolveScreenHost(directTarget)
  );
  const directCharge = directIsCharge
    ? directTarget
    : pickLiveElectroCharge(hits);
  if (directCharge) {
    expManager.beginManipulation(directCharge, {
      ...(directContext || {}),
      time: directContext?.time ?? t,
      raycaster: inputRaycaster,
    });
    return true;
  }

  // Prefer a nearby Hall terminal for desktop mouse grabs even when the ray
  // intersects the console/deck first.  The fallback is intentionally only
  // used for a live Hall experiment and remains narrow enough to distinguish
  // the adjacent red/black sockets.
  // AR directContext used to suppress this fallback — keep it for pinch too.
  const terminalFallback = expManager?.state?.expId === 'hall_effect'
    ? hallBench?.userData?.getHallTerminalTarget?.(inputRaycaster, { maxDistance: 0.045 })
    : null;
  const target = directTarget || terminalFallback?.target || resolveInteractivePreferred(hits);

  // Front wall formula board (only within ~1/3 lab depth)
  if (target?.userData?.type === 'formula_board' || target?.userData?.role === 'formula_board') {
    const board = formulaBoard;
    const boardHit = hits.find((h) => {
      const o = resolveInteractive(h.object);
      return o && (o.userData.type === 'formula_board' || o.userData.role === 'formula_board');
    });
    if (boardHit && !withinInteractDist(board, boardHit.distance)) {
      if (!directContext) frontWallTooFarToast();
      return false;
    }
    const pick = board?.userData?.pickFromRay?.(inputRaycaster);
    if (pick) {
      board.userData.applyPick(pick);
      return true;
    }
    if (!boardHit || withinInteractDist(board, boardHit.distance)) {
      if (!directContext) showToast('瞄准分类标签或公式卡片后点击');
    }
    return !directContext;
  }

  // Front-wall chalkboards share the same near-third range to avoid far mis-taps.
  if (target?.userData?.type === 'side_blackboard' || target?.userData?.role === 'side_blackboard') {
    const board = resolveSideBlackboardHost(target) || target;
    const boardHit = hits.find((h) => {
      const o = resolveInteractive(h.object);
      return o && (o.userData.type === 'side_blackboard' || o.userData.role === 'side_blackboard');
    });
    if (boardHit && !withinInteractDist(board, boardHit.distance)) {
      if (!directContext) frontWallTooFarToast();
      return false;
    }
    const pick = board.userData.pickFromRay?.(inputRaycaster);
    if (!pick) {
      if (boardHit && withinInteractDist(board, boardHit.distance)) {
        if (!directContext) showToast('瞄准黑板工具栏或书写区后点击');
      }
      return !directContext;
    }
    if (pick.action === 'color' || pick.action === 'size' || pick.action === 'eraser' || pick.action === 'clear') {
      board.userData.applyPick(pick);
      if (pick.action === 'color') showToast('已选择画笔颜色');
      else if (pick.action === 'size') showToast('已选择画笔粗细');
      else if (pick.action === 'eraser') {
        showToast(blackboardBrush.mode === 'eraser' ? '橡皮模式 · 按住拖动画擦除' : '已切回画笔');
      } else if (pick.action === 'clear') {
        showToast('黑板已清屏');
      }
    } else if (pick.action === 'draw') {
      board.userData.drawFromRay?.(inputRaycaster);
    }
    return true;
  }

  // Hologram mesh/hitbox (pedestal / content frame) when not on the screen plane
  if (
    target?.userData?.type === 'holo'
    || target?.userData?.type === 'holo_display'
    || target?.userData?.role === 'holo_selector'
    || target?.userData?.role === 'holo_display'
  ) {
    const screen = resolveScreenHost(target) || target;
    const sid = screen.userData.stationId;
    const isDisplay = screen.userData.type === 'holo_display'
      || screen.userData.role === 'holo_display';
    // Hidden content screens must not swallow clicks / block the lab.
    if (isDisplay && !(screen.userData.present && screen.visible)) {
      // fall through to equipment / other targets
    } else if (screen?.userData?.active || screen?.userData?.present) {
      // Prefer dedicated plane raycast (hit box has no reliable UV)
      const pick = screen.userData.pickFromRay?.(inputRaycaster)
        || (lastFocusHit?.uv ? screen.userData.pick?.(lastFocusHit.uv) : null);
      if (pick) {
        if (isParamSliderAction(pick.action)) {
          expManager.beginManipulation(screen, {
            ...(directContext || {}),
            time: directContext?.time ?? t,
            raycaster: inputRaycaster,
            pick,
          });
          return true;
        }
        if (pick.action === 'hall-scroll-table' || pick.role === 'scrollable_table' || pick.role === 'scrollable_components') {
          if (directContext) {
            expManager.beginManipulation(screen, {
              ...directContext,
              time: directContext.time ?? t,
              raycaster: inputRaycaster,
              pick,
            });
          } else {
            handleHoloScreenAction(pick, sid);
          }
          return true;
        }
        handleHoloScreenAction(pick, sid);
        return true;
      }
      // AR: selector hitbox without UV still activates the station menu.
      if (!isDisplay) {
        handleHoloScreenAction({ action: 'activate', stationId: sid }, sid);
        return true;
      }
      if (!directContext) {
        showToast(isDisplay
          ? '请瞄准内容屏上的控件'
          : '请瞄准桌面终端上的实验卡片');
      }
      return false;
    } else if (!isDisplay) {
      expManager.interact(screen, t);
      return true;
    }
  }

  if (target) {
    if (directContext) {
      expManager.beginManipulation(target, {
        ...directContext,
        time: directContext.time ?? t,
        raycaster: inputRaycaster,
      });
    } else {
      expManager.interact(target, t);
    }
    return true;
  }
  if (!directContext && expManager.state.running) {
    expManager.interact({ userData: { role: 'generic' } }, t);
    return true;
  }
  return false;
}

function syncMouseDragState() {
  // AR pinch is treated as a virtual mouse button:
  // - pinch down  → holdLMB (same as left mouse down)
  // - pinch hold  → continuous drag via mouseDrag totals
  // - pinch up    → release
  // Dual-hand dolly does not count as a click/hold.
  const primary = handTracking?.getPrimaryInteraction?.();
  const isPinching = !!(primary?.holding && !primary?.dual);
  const holding = holdLMB || isPinching;
  if (equipment?.electro?.mouseDrag) equipment.electro.mouseDrag.holdLMB = holding;
  if (equipment?.optics?.mouseDrag) equipment.optics.mouseDrag.holdLMB = holding;
  if (equipment?.mechanics?.mouseDrag) equipment.mechanics.mouseDrag.holdLMB = holding;
  if (equipment?.thermo?.mouseDrag) equipment.thermo.mouseDrag.holdLMB = holding;
}

function resetMouseDragAccum() {
  if (equipment?.electro?.mouseDrag) {
    equipment.electro.mouseDrag.movementX = 0;
    equipment.electro.mouseDrag.movementY = 0;
    equipment.electro.mouseDrag.shiftKey = false;
  }
  if (equipment?.optics?.mouseDrag) equipment.optics.mouseDrag.movementX = 0;
  if (equipment?.mechanics?.mouseDrag) {
    equipment.mechanics.mouseDrag.movementX = 0;
    equipment.mechanics.mouseDrag.movementY = 0;
  }
}

function accumulateMouseDrag(dx, dy = 0, mods = null) {
  if (equipment?.electro?.mouseDrag) {
    equipment.electro.mouseDrag.movementX += dx;
    equipment.electro.mouseDrag.movementY += dy;
    if (mods && typeof mods.shiftKey === 'boolean') {
      equipment.electro.mouseDrag.shiftKey = mods.shiftKey;
    }
  }
  if (equipment?.optics?.mouseDrag) equipment.optics.mouseDrag.movementX += dx;
  if (equipment?.mechanics?.mouseDrag) {
    equipment.mechanics.mouseDrag.movementX = (equipment.mechanics.mouseDrag.movementX || 0) + dx;
    equipment.mechanics.mouseDrag.movementY = (equipment.mechanics.mouseDrag.movementY || 0) + dy;
  }
}

// ── Camera-based AR input powered by local MediaPipe hand tracking ──
const handToggleEl = document.getElementById('hand-tracking-toggle');
const handStatusEl = document.getElementById('hand-tracking-status');
const handVideoEl = document.getElementById('hand-tracking-video');
const arTutorialEl = document.getElementById('ar-tutorial');
const helpToggleEl = document.getElementById('help-toggle');
const helpModalWrapEl = document.getElementById('help-modal-wrap');
const helpCloseEl = document.getElementById('help-close');
const helpConfirmEl = document.getElementById('help-confirm');
const helpBackdropEl = document.getElementById('help-modal-backdrop');
let handTrackingPhase = 'off';
let handTrackingDetail = 'AR 模式已关闭 · H';
let arInteractionLabel = '准备';
let arTrackingFps = 0;
let arPipelineMs = 0;
let arTutorialTimer = 0;

function renderArStatus() {
  if (!handStatusEl) return;
  const performanceText = arTrackingFps
    ? ` · ${Math.round(arTrackingFps)} FPS${arPipelineMs ? ` · ${Math.round(arPipelineMs)} ms` : ''}`
    : '';
  handStatusEl.textContent = handTrackingPhase === 'running'
    ? `${arInteractionLabel}${performanceText}`
    : (handTrackingDetail || 'AR 模式已关闭 · H');
}

function updateArPhase(snapshot) {
  arInteractionLabel = snapshot?.label || '准备';
  ['navigating', 'looking', 'manipulating', 'tracking-lost'].forEach((phase) => {
    document.body.classList.toggle(`ar-${phase}`, snapshot?.phase === phase);
  });
  updateArStatus({ phase: snapshot?.phase || 'off', status: arInteractionLabel });
  renderArStatus();
}

function showArTutorial() {
  if (!arTutorialEl) return;
  let alreadyShown = false;
  try {
    alreadyShown = localStorage.getItem('physics-lab-ar-tutorial') === 'shown';
    if (!alreadyShown) localStorage.setItem('physics-lab-ar-tutorial', 'shown');
  } catch { /* storage is optional */ }
  if (alreadyShown) return;
  arTutorialEl.classList.add('is-visible');
  updateTutorial(true);
  window.clearTimeout(arTutorialTimer);
  arTutorialTimer = window.setTimeout(() => {
    arTutorialEl.classList.remove('is-visible');
    updateTutorial(false);
  }, 7000);
}

function updateHandTrackingStatus({
  phase,
  detail,
  activeHand = null,
  trackingFps = 0,
  inferenceMs = 0,
  pipelineMs = 0,
  droppedFrames = 0,
  workerRestarts = 0,
  dropRate = 0,
  pinchRatios = null,
  degraded = false,
}) {
  arTrackingFps = trackingFps;
  arPipelineMs = pipelineMs;
  handTrackingPhase = phase;
  handTrackingDetail = detail || (phase === 'off' ? 'AR 模式已关闭 · H' : '准备');
  updateArStatus({
    active: phase === 'running',
    phase,
    detail: handTrackingDetail,
    status: phase === 'running' ? (arInteractionLabel || '准备') : handTrackingDetail,
    activeHand,
    trackingFps,
    inferenceMs,
    pipelineMs,
    degraded,
  });
  document.body.classList.toggle('hand-tracking-loading', phase === 'loading' || phase === 'permission');
  document.body.classList.toggle('hand-tracking-active', phase === 'running');
  document.body.classList.toggle('hand-tracking-error', phase === 'error');
  document.body.classList.toggle('hand-tracking-degraded', phase === 'running' && degraded);
  handToggleEl?.setAttribute('aria-pressed', String(phase === 'running'));
  if (handToggleEl) {
    handToggleEl.disabled = phase === 'loading' || phase === 'permission';
    handToggleEl.dataset.activeHand = activeHand || '';
    handToggleEl.dataset.trackingFps = trackingFps ? String(Math.round(trackingFps)) : '';
    handToggleEl.dataset.inferenceMs = inferenceMs ? inferenceMs.toFixed(1) : '';
    handToggleEl.dataset.pipelineMs = pipelineMs ? pipelineMs.toFixed(1) : '';
    handToggleEl.dataset.droppedFrames = String(droppedFrames);
    handToggleEl.dataset.workerRestarts = String(workerRestarts);
    handToggleEl.dataset.dropRate = dropRate ? dropRate.toFixed(3) : '';
    const leftPinch = pinchRatios?.Left;
    const rightPinch = pinchRatios?.Right;
    handToggleEl.dataset.leftPinchRaw = Number.isFinite(leftPinch?.raw)
      ? leftPinch.raw.toFixed(3) : '';
    handToggleEl.dataset.leftPinchFiltered = Number.isFinite(leftPinch?.filtered)
      ? leftPinch.filtered.toFixed(3) : '';
    handToggleEl.dataset.rightPinchRaw = Number.isFinite(rightPinch?.raw)
      ? rightPinch.raw.toFixed(3) : '';
    handToggleEl.dataset.rightPinchFiltered = Number.isFinite(rightPinch?.filtered)
      ? rightPinch.filtered.toFixed(3) : '';
    handToggleEl.title = phase === 'running'
      ? `关闭 AR 模式（H）${degraded ? ' · 兼容模式' : ''}${detail ? ` · ${detail}` : ''}`
      : '开启 AR 模式（H）';
  }
  renderArStatus();
  if (phase === 'error') showToast(detail || 'AR 模式启动失败');
}

const handTrackingOptions = {
  camera,
  scene,
  video: handVideoEl,
  resolveTarget: (inputRaycaster, _handLabel, handNdc) => {
    const { target, hit } = getHandFocusInfo(inputRaycaster, handNdc);
    const distance = THREE.MathUtils.clamp(Number(hit?.distance || 4.5), 0.35, 4.5);
    return { target, distance };
  },
  onPinchStart: (event) => {
    if (event?.hand) pinchStartTimes.set(event.hand, performance.now());
    arInteractionController?.onPinchStart(event);
  },
  onPinchMove: (event) => arInteractionController?.onPinchMove(event),
  onPinchEnd: (event) => {
    if (event?.hand) pinchStartTimes.delete(event.hand);
    arInteractionController?.onPinchEnd(event);
  },
  onStatus: updateHandTrackingStatus,
};

const arInteractionOptions = {
  getHandState: (label) => handTracking?.getHandState?.(label),
  beginManipulation: (event) => {
    // Pinch = mouse button down + click at the fingertip ray.
    resetMouseDragAccum();
    holdLMB = true;
    syncMouseDragState();

    const ray = event?.raycaster;
    if (!ray) return false;

    // Re-resolve at the exact pinch frame from the live ray. Do not trust a
    // stale lockedTarget — AR tip lock often lags or misses UV faces.
    const focus = getHandFocusInfo(ray, event?.ndc);
    const holo = getAimedHoloControl(ray);
    const deskHost = resolveDeskSliderHost(focus?.target)
      || resolveDeskSliderHost(event?.target);
    const deskPick = deskHost?.userData?.present
      ? deskHost.userData.pickFromRay?.(ray)
      : null;
    const target = holo?.target
      || focus?.target
      || resolveScreenHost(event?.target)
      || event?.target
      || null;

    const hit = tryInteract(ray, true, {
      direct: true,
      target,
      time: clock.elapsedTime,
      pick: isDeskPanelPick(deskPick) ? deskPick : (holo?.pick || null),
    });
    // Stash resolved target so drag/end use the same object the click armed.
    if (hit && target && event) event.target = target;
    return !!hit;
  },
  updateManipulation: (event) => {
    // Pinch hold = mouse drag (movement accumulates into mouseDrag facade).
    holdLMB = true;
    syncMouseDragState();
    accumulateMouseDrag(
      THREE.MathUtils.clamp(Number(event.dx || 0), -60, 60),
      THREE.MathUtils.clamp(Number(event.dy || 0), -60, 60),
    );
    expManager?.updateManipulation(event.target, {
      ...event,
      time: clock.elapsedTime,
      raycaster: event.raycaster || null,
    });
    // Also drive continuous hold for experiments that only use holdInteract
    // (e.g. Hall probe, Faraday rod, optics sliders, thermo beaker).
    expManager?.holdInteract(true, clock.elapsedTime, 0, event.target);
  },
  endManipulation: (event) => {
    expManager?.endManipulation(event.target, {
      ...event,
      time: clock.elapsedTime,
    });
    sideBlackboards.forEach((board) => board.userData.stopStroke?.());
    // Pinch up = mouse button up.
    holdLMB = false;
    syncMouseDragState();
    // Release continuous hold for experiments that only use holdInteract
    expManager?.holdInteract(false, clock.elapsedTime, 0, event.target);
  },
  onLook: (dx, dy) => {
    // Soft clamp avoids rare tracking spikes without hard edge feel.
    const lookDx = THREE.MathUtils.clamp(dx, -48, 48);
    const lookDy = THREE.MathUtils.clamp(dy, -48, 48);
    applyCameraLookDelta(lookDx, lookDy, {
      sensitivityX: 0.0024,
      sensitivityY: 0.0024,
      minPitch: -THREE.MathUtils.degToRad(80),
      maxPitch: THREE.MathUtils.degToRad(80),
    });
  },
  onPhaseChange: updateArPhase,
  dollyOptions: { gain: 48, deadZone: 0.0008 },
  lookOptions: {
    minCutoff: 0.9,
    beta: 0.55,
    sensitivity: 0.95,
    outputFollow: 22,
    maxStepPx: 40,
  },
};

let arInteractionReady = null;
async function ensureArInteractionController() {
  if (arInteractionController) return arInteractionController;
  if (!arInteractionReady) {
    arInteractionReady = import('./arInteraction.js').then(({ createArInteractionController }) => {
      arInteractionController = createArInteractionController(arInteractionOptions);
      return arInteractionController;
    });
  }
  return arInteractionReady;
}

let handTrackingReady = null;
async function ensureHandTracking() {
  if (handTracking) return handTracking;
  if (!handTrackingReady) {
    handTrackingReady = Promise.all([
      ensureArInteractionController(),
      import('./handTracking.js'),
    ]).then(([, { createHandTracking }]) => {
      handTracking = createHandTracking(handTrackingOptions);
      return handTracking;
    });
  }
  return handTrackingReady;
}

async function toggleHandTracking() {
  await ensureArInteractionController();
  const tracker = await ensureHandTracking();
  if (tracker.isStarting()) return;
  if (controls.isLocked) controls.unlock();
  const active = await tracker.toggle();
  // Do not let AR callbacks compete with pointer-lock mouse interaction.
  arInteractionController.setEnabled(active && !controls.isLocked);
  if (active) showArTutorial();
  else {
    arTutorialEl?.classList.remove('is-visible');
    updateTutorial(false);
  }
}

handToggleEl?.addEventListener('mousedown', (event) => event.stopPropagation());
handToggleEl?.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleHandTracking();
});
function disposeIntentPrepareResources() {
  intentPrewarmPromises.forEach((promise) => promise.catch?.(() => {}));
  intentPrewarmPromises.clear();
  if (activeIntentPrewarm?.key) experimentTransition.cancelPrewarm(activeIntentPrewarm.key);
  activeIntentPrewarm = null;
  clearTimeout(focusedExperimentTimer);
  focusedExperimentTimer = 0;
  focusedExperimentKey = null;
  intentPrepareScene?.clear?.();
  intentPrepareScene = null;
  intentPrepareCamera = null;
  intentPrepareTarget?.dispose?.();
  intentPrepareTarget = null;
}

let labRuntimeDisposed = false;
let removeTauriWindowListeners = null;
function disposeLabRuntimeResources() {
  if (labRuntimeDisposed) return;
  labRuntimeDisposed = true;
  removeTauriWindowListeners?.();
  removeTauriWindowListeners = null;
  handTracking?.destroy?.();
  labFrameScheduler.clear();
  frameCoordinator.cancelAll();
  experimentTransition.dispose();
  experimentRuntimeCache.clear();
  stationRuntimeCache.clear();
  disposeIntentPrepareResources();
  renderer.dispose?.();
}

window.addEventListener('beforeunload', disposeLabRuntimeResources, { once: true });
void installTauriWindowLifecycle({
  onHidden: () => {
    labFrameScheduler.clear();
    frameCoordinator.cancelAll();
    frameCoordinator.reset?.();
    handTracking?.pause?.();
  },
  onShown: () => {
    clock.getDelta();
    frameCoordinator.reset?.();
    frameCoordinator.invalidate();
    handTracking?.resume?.();
  },
  onResize: resizeRendererViewport,
  onClose: disposeLabRuntimeResources,
}).then((remove) => {
  if (labRuntimeDisposed) remove?.();
  else removeTauriWindowListeners = remove;
}).catch(() => {});

function openHelpModal() {
  if (controls.isLocked) controls.unlock();
  if (helpModalWrapEl) {
    helpModalWrapEl.classList.add('is-open');
    helpModalWrapEl.setAttribute('aria-hidden', 'false');
  }
}

function closeHelpModal() {
  if (helpModalWrapEl) {
    helpModalWrapEl.classList.remove('is-open');
    helpModalWrapEl.setAttribute('aria-hidden', 'true');
  }
}

function toggleHelpModal() {
  if (helpModalWrapEl?.classList.contains('is-open')) closeHelpModal();
  else openHelpModal();
}

helpToggleEl?.addEventListener('mousedown', (e) => e.stopPropagation());
helpToggleEl?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleHelpModal();
});
helpCloseEl?.addEventListener('click', (e) => { e.stopPropagation(); closeHelpModal(); });
helpConfirmEl?.addEventListener('click', (e) => { e.stopPropagation(); closeHelpModal(); });
helpBackdropEl?.addEventListener('click', (e) => { e.stopPropagation(); closeHelpModal(); });

document.addEventListener('keydown', (e) => {
  if (helpModalWrapEl && helpModalWrapEl.classList.contains('is-open')) {
    if (e.code === 'Escape') {
      e.preventDefault();
      closeHelpModal();
      return;
    }
  }
  if (e.code === 'KeyH' && !e.repeat) {
    toggleHandTracking();
  }
  if (e.code === 'KeyE') {
    if (!holdE) tryInteract();
    holdE = true;
  }
  if (expManager) expManager.onKey(e.code, clock.elapsedTime);
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'KeyE') holdE = false;
});
document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && controls.isLocked) {
    holdLMB = true;
    resetMouseDragAccum();
    syncMouseDragState();
    tryInteract();
  }
});
document.addEventListener('mousemove', (e) => {
  if (!controls.isLocked || !holdLMB) return;
  accumulateMouseDrag(Number(e.movementX || 0), Number(e.movementY || 0), { shiftKey: !!e.shiftKey });
  if (expManager?.state?.running) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    expManager.updateManipulation(null, {
      time: clock.elapsedTime,
      raycaster,
    });
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    if (controls.isLocked && expManager?.state?.running) {
      expManager.endManipulation(null, { time: clock.elapsedTime });
    }
    holdLMB = false;
    sideBlackboards.forEach((board) => board.userData.stopStroke?.());
    syncMouseDragState();
  }
});
// If pointer unlocks mid-drag, release LMB grab
controls.addEventListener('unlock', () => {
  holdLMB = false;
  holdE = false;
  sideBlackboards.forEach((board) => board.userData.stopStroke?.());
  syncMouseDragState();
});
document.addEventListener('wheel', (e) => {
  if (!expManager || holoFsState?.open) return;

  let target = null;
  let pickRay = raycaster;
  if (controls.isLocked) {
    // Pointer-lock input uses the crosshair at the center of the viewport.
    target = getFocusTarget(raycaster);
  } else {
    // When the cursor is free, only the WebGL canvas should be treated as a
    // 3D interaction surface. Build a ray through the actual cursor position
    // so moving the cursor over a content screen selects that screen.
    if (e.target !== canvas && !canvas.contains?.(e.target)) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    wheelRaycaster.setFromCamera(ndc, camera);
    pickRay = wheelRaycaster;
    target = getFocusTarget(wheelRaycaster);
  }

  // Resolve the aimed content screen once more before dispatching the wheel.
  // This intentionally outranks nearby apparatus hitboxes: when the crosshair
  // is on the data table, the wheel belongs to that table, not to a coil or
  // console behind the panel.
  const aimedScreen = getAimedHolo(pickRay);
  if (aimedScreen) target = aimedScreen;
  const pick = target?.userData?.pickFromRay ? target.userData.pickFromRay(pickRay) : null;
  // Prefer the scrollable-table hit metadata even when the ray currently rests
  // on a nearby button, so maxRows/maxStart match the painted viewport.
  let wheelPick = pick;
  if (pick?.action !== 'hall-scroll-table' && pick?.role !== 'scrollable_table' && pick?.role !== 'scrollable_components') {
    const regions = target?.userData?.hitRegions;
    const scrollHit = Array.isArray(regions)
      ? regions.find((h) => h?.action === 'hall-scroll-table' || h?.role === 'scrollable_table' || h?.role === 'scrollable_components')
      : null;
    if (scrollHit) wheelPick = scrollHit;
  }
  if (expManager.onWheel(e.deltaY, target, wheelPick)) e.preventDefault();
}, { passive: false });

// prevent exp panel clicks from locking issues
expPanel.addEventListener('mousedown', (e) => e.stopPropagation());

// ═══════════════════════════════════════════════
//  Bounds / Loop
// ═══════════════════════════════════════════════
const BOUND = {
  minX: -ROOM_W / 2 + 0.45,
  maxX: ROOM_W / 2 - 0.45,
  minZ: -ROOM_D / 2 + 0.45,
  maxZ: ROOM_D / 2 - 0.45,
  minY: 0.4,
  maxY: 3.3,
};

function resizeRendererViewport() {
  applyLabViewportSize({
    updateCamera: true,
    pixelRatio: getLabPixelRatio(),
  });
  // frameCoordinator is created later in this module; avoid TDZ on early RO/resize.
  try { frameCoordinator.invalidate(); } catch { /* boot */ }
}

window.addEventListener('resize', resizeRendererViewport);
// Iframe / desktop-shell layout changes often resize the canvas without a
// window.resize (parent title bar, dock, snap). Observe the element box so
// aspect + buffer stay locked to what the user actually sees — the F11-only
// "fix" was just a forced window resize.
if (typeof ResizeObserver !== 'undefined' && canvas) {
  let roRaf = 0;
  const canvasRo = new ResizeObserver(() => {
    if (roRaf) return;
    roRaf = requestAnimationFrame(() => {
      roRaf = 0;
      resizeRendererViewport();
    });
  });
  canvasRo.observe(canvas);
}

const clock = new THREE.Clock();

/**
 * Post-render only: canvas HUD paints / one-shot attach work.
 * Keep this tight — after any heavy job the scheduler also inserts a
 * camera-only cooldown frame so look/WASD stay continuous during switches.
 */
/** Hard 2 ms background budget after present (skipped if render already > 16.7). */
const POST_RENDER_BUDGET_MS = 2.0;
let slowRenderTraceCount = 0;

function getRenderTraceSceneStats() {
  return scene.children.map((root) => {
    let meshes = 0;
    let transmissive = 0;
    let casters = 0;
    if (root?.traverse) {
      root.traverse((object) => {
        if (!object.isMesh || !object.visible) return;
        meshes += 1;
        if (object.castShadow) casters += 1;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some((material) => Number(material?.transmission || 0) > 0)) transmissive += 1;
      });
    }
    return {
      name: root?.name || root?.type || 'unnamed',
      visible: !!root?.visible,
      meshes,
      transmissive,
      casters,
    };
  }).filter((item) => item.meshes || item.visible);
}

// The coordinator owns WebGL present and the fixed-step sim seam.
// SimDriver re-homes experiment integration out of animate()'s expManager.update
// so Physics/Sim workers can run latest-complete-wins without a second clock.
//
// RenderBackend is the stable present seam. Default mode is main — the full
// lab scene graph stays on this thread. Never transferControlToOffscreen on
// the primary lab canvas (#c) until the scene has been migrated.
const renderBackend = createRenderBackend({
  mode: 'main',
  renderer,
  scene,
  camera,
  render: () => {
    if (labPostProcessing) labPostProcessing.render();
    else renderer.render(scene, camera);
  },
});

/** Single fixed-step owner for live experiment simulation. */
const simDriver = createSimDriver();
simDriver.bind({
  simulate: (dt) => expManager?.fixedUpdate?.(dt),
  visual: (alpha) => expManager?.visualUpdate?.(alpha),
  isActive: () => !!expManager?.state?.running,
});
// Handlers still expose update(); driver owns the integrate call site.
expManager?.setSimOwnedByDriver?.(true);

// A selected experiment may need several asynchronous GPU preparation slices.
// Keep the old lab frame on screen while those slices yield so a partially
// mounted apparatus cannot become visible and then freeze on its first draw.
let gpuPrepareInProgress = false;
const frameCoordinator = createFrameCoordinator({
  fixedDt: 1 / 60,
  maxCatchUp: 2,
  onFixedUpdate: (dt) => {
    const simResult = simDriver.fixedUpdate(dt);
    performanceGovernor.recordSimulation(simResult?.ms || simDriver.lastFixedMs || 0);
    experimentTransition.current?.fixedUpdate?.(dt);
  },
  onVisualUpdate: (alpha) => {
    simDriver.visualUpdate(alpha);
    experimentTransition.current?.visualUpdate?.(alpha);
  },
  onRender: () => {
    if (gpuPrepareInProgress) {
      noteSwitchStage('render', 0);
      return;
    }
    const renderNow = performance.now();
    scheduleShadowRefresh(renderNow, {
      switching: !!labFrameScheduler.softSwitchActive?.(),
      dynamic: !!expManager?.state?.running,
    });
    const renderT0 = performance.now();
    const presentResult = renderBackend.present();
    const renderMs = presentResult?.ms ?? (performance.now() - renderT0);
    performanceGovernor.recordRender(renderMs);
    if (renderMs > 100 && slowRenderTraceCount < 12) {
      slowRenderTraceCount += 1;
      let visibleMeshes = 0;
      let transmissiveMaterials = 0;
      let shadowCasters = 0;
      scene.traverse((object) => {
        if (!object.visible || !object.isMesh) return;
        visibleMeshes += 1;
        if (object.castShadow) shadowCasters += 1;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some((material) => Number(material?.transmission || 0) > 0)) {
          transmissiveMaterials += 1;
        }
      });
      console.warn('[render-trace]', JSON.stringify({
        renderMs: Number(renderMs.toFixed(1)),
        visibleMeshes,
        transmissiveMaterials,
        shadowCasters,
        shadowNeedsUpdate: !!renderer.shadowMap.needsUpdate,
        render: { ...renderer.info.render },
        memory: { ...renderer.info.memory },
        programs: renderer.info.programs?.length || 0,
        roots: getRenderTraceSceneStats(),
      }));
    }
    noteSwitchStage('render', renderMs);
    {
      const sample = Number(renderMs.toFixed(2));
      if (labPerfStats.frameSamples.length < 240) labPerfStats.frameSamples.push(sample);
      else {
        labPerfStats.frameSampleWrite = (labPerfStats.frameSampleWrite || 0) % 240;
        labPerfStats.frameSamples[labPerfStats.frameSampleWrite] = sample;
        labPerfStats.frameSampleWrite += 1;
      }
    }
    // Render already over budget → skip background drain this frame.
    if (renderMs <= 16.7) {
      const drainT0 = performance.now();
      labFrameScheduler.drain(POST_RENDER_BUDGET_MS);
      noteSwitchStage('scheduler', performance.now() - drainT0);
    }
  },
});

let webglContextLost = false;
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  webglContextLost = true;
  const pendingWarmup = shaderWarmupPromise;
  shaderWarmup.cancel();
  shaderWarmup.reset({ persist: false });
  labFrameScheduler.clear();
  expManager?.cancelPendingStart?.();
  frameCoordinator.cancelAll();
  frameCoordinator.reset?.();
  experimentTransition.dispose();
  experimentRuntimeCache.clear();
  stationRuntimeCache.clear();
  disposeIntentPrepareResources();
  showToast('Graphics context lost; restoring the laboratory');
  // If a background queue was active, resume it only after the browser has
  // finished restoring the context. The persisted record remains intact, but
  // this context must compile its programs again.
  if (pendingWarmup) pendingWarmup.catch(() => {});
});

// Development/QA escape hatch: append ?shaderWarmup=reset to a local launch
// to remove the persisted completion record and observe the real sequential
// compile UI again. It is intentionally opt-in and never runs in production
// without the explicit query parameter.
if (shaderWarmupResetRequested) shaderWarmup.reset();

canvas.addEventListener('webglcontextrestored', () => {
  webglContextLost = false;
  applyLabViewportSize({
    updateCamera: true,
    pixelRatio: getLabPixelRatio(),
  });
  labPostProcessing?.resize(
    getLabViewportSize().width,
    getLabViewportSize().height,
    getLabPixelRatio(),
  );
  frameCoordinator.reset?.();
  frameCoordinator.invalidate();
  showToast('Graphics restored; select an experiment to reload it');
  const resume = () => {
    if (!webglContextLost) void startBackgroundShaderWarmup({ force: true });
  };
  if (shaderWarmupPromise) void shaderWarmupPromise.catch(() => {}).then(resume);
  else requestAnimationFrame(resume);
});

let pendingRafId = null;

function cancelPendingFrames() {
  if (pendingRafId !== null) {
    cancelAnimationFrame(pendingRafId);
    pendingRafId = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    cancelPendingFrames();
    labFrameScheduler.clear();
    frameCoordinator.cancelAll();
    frameCoordinator.reset?.();
    return;
  }
  // Reset the clock on resume so a hidden-window gap cannot produce catch-up
  // simulation steps or an artificial long-frame DPR downgrade.
  clock.getDelta();
  frameCoordinator.reset?.();
  frameCoordinator.invalidate();
  if (pendingRafId === null) {
    pendingRafId = requestAnimationFrame(animate);
  }
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', cancelPendingFrames);
}

function animate(tickTime = performance.now()) {
  pendingRafId = requestAnimationFrame(animate);
  if (typeof document === 'undefined' || !document.body || !renderer) {
    return;
  }
  if (document.visibilityState === 'hidden') {
    return;
  }
  // During boot, leave main-thread budget to loader paints so chrome stays responsive.
  if (bootSuspendRender) {
    labFrameScheduler.drain(1);
    return;
  }
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const nowMs = Number.isFinite(tickTime) ? tickTime : performance.now();
  const traceFrames = typeof window !== 'undefined' && (
    window.__LAB_TRACE
    || new URLSearchParams(window.location.search).has('trace')
    || new URLSearchParams(window.location.search).has('measure')
  );
  performanceGovernor.beginFrame(performance.now());
  renderer.info.reset?.();
  const arActive = !!handTracking?.isActive();
  const softSwitch = !!labFrameScheduler.softSwitchActive?.();
  labFrameScheduler.tickSoftSwitch?.();
  if (softSwitch && !switchFrameMetrics.active) beginSwitchFrameMetrics();
  if (!softSwitch && switchFrameMetrics.active) switchFrameMetrics.active = false;

  // Camera inference is throttled internally and only runs in user-enabled AR mode.
  // During experiment switch, skip AR vision work — it steals frames from look/WASD.
  if (!softSwitch) {
    handTracking?.update(nowMs);
  }
  const arState = (!softSwitch && arActive)
    ? arInteractionController?.update(nowMs)
    : null;

  if (controls.isLocked || arActive || touchNavigationActive) {
    velocity.x -= velocity.x * 9.0 * dt;
    velocity.z -= velocity.z * 9.0 * dt;
    velocity.y -= velocity.y * 9.0 * dt;

    direction.z = Number(move.forward) - Number(move.back);
    direction.x = Number(move.right) - Number(move.left);
    direction.normalize();

    if (move.forward || move.back) velocity.z -= direction.z * SPEED * 12 * dt;
    if (move.left || move.right) velocity.x -= direction.x * SPEED * 12 * dt;
    if (move.up) velocity.y += SPEED * 10 * dt;
    if (move.down) velocity.y -= SPEED * 10 * dt;

    controls.moveRight(-velocity.x * dt);
    controls.moveForward(-velocity.z * dt);
    camera.position.y += velocity.y * dt;

    if (arActive && arState) {
      const arMoveSpeed = arState.dualNavigating ? AR_DOLLY_SPEED : AR_SPEED;
      const arDamp = arState.dualNavigating ? 14 : (arState.manipulating ? 16 : 9);
      arVelocity.x = THREE.MathUtils.damp(
        arVelocity.x,
        arState.movement.strafe * arMoveSpeed,
        arDamp,
        dt,
      );
      arVelocity.y = THREE.MathUtils.damp(
        arVelocity.y,
        arState.movement.forward * arMoveSpeed,
        arDamp,
        dt,
      );
      controls.moveRight(arVelocity.x * dt);
      controls.moveForward(arVelocity.y * dt);
    } else {
      arVelocity.set(0, 0);
    }

    camera.position.x = THREE.MathUtils.clamp(camera.position.x, BOUND.minX, BOUND.maxX);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, BOUND.minZ, BOUND.maxZ);
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, BOUND.minY, BOUND.maxY);
  }

  predictStationPreload(nowMs);

  // Soft switch: camera + present + tiny budget only. Prefer NOT using long
  // soft-switch for optics open — that feels like a stuck screen.
  // Freeze SimDriver so fixed steps do not fight switch jobs on the main thread.
  if (softSwitch) {
    simDriver.pause();
    const softCoordinatorStart = traceFrames ? performance.now() : 0;
    const softCoordinatorResult = frameCoordinator.frame(nowMs, { render: true });
    if (traceFrames) {
      const softFrameMs = performance.now() - frameTraceStart;
      if (softFrameMs > 100) {
        console.warn('[frame-trace]', JSON.stringify({
          frameMs: Number(softFrameMs.toFixed(1)),
          coordinatorMs: Number((performance.now() - softCoordinatorStart).toFixed(1)),
          renderMs: Number(softCoordinatorResult?.renderMs?.toFixed?.(1) || 0),
          running: !!expManager?.state?.running,
          expId: expManager?.state?.expId || null,
          softSwitch: true,
          gpuPrepareInProgress,
        }));
      }
    }
    // The soft-switch path returns before the normal post-render drain below.
    // Keep draining the tiny background queue here as well; otherwise the
    // experiment switch chain and the content-screen full-paint job can never
    // run, leaving the display permanently on its loading shell.
    const drainT0 = performance.now();
    labFrameScheduler.drain(POST_RENDER_BUDGET_MS);
    noteSwitchStage('scheduler', performance.now() - drainT0);
    switchFrameMetrics.frames += 1;
    switchFrameMetrics.maxFrameMs = Math.max(
      switchFrameMetrics.maxFrameMs,
      performance.now() - nowMs,
    );
    performanceGovernor.setRuntimeInfo({
      workerMode: globalThis.__PHYSICS_BACKEND_MODE__ || 'auto',
      sharedArrayBuffer: globalThis.crossOriginIsolated === true,
      workerPending: labFrameScheduler.pending?.() || 0,
    });
    performanceGovernor.endFrame(performance.now());
    return;
  }
  simDriver.resume();

  // Keep the selected DPR stable while geometric optics and experiment content
  // are active; performance pressure is reported by the governor instead of
  // silently changing visual quality.
  // experiment simulation — every frame, same as the standalone sources
  if (expManager) {
    syncMouseDragState();
    const handInteraction = handTracking?.getPrimaryInteraction?.();
    const pointerTarget = getFocusTarget();
    // Once pointer lock is active, the mouse owns the central ray.  AR hands
    // remain rendered, but their hover/hold state must not shadow mouse gear
    // controls or keep a stale terminal drag alive.
    // Pinch maps to mouse click/hold: when pinching, use the hand ray target
    // (or the locked pinch target) so holdInteract sees the same apparatus
    // the fingertip is pointing at — just like a mouse long-press.
    const arPinchActive = !!(handInteraction?.holding && !handInteraction?.dual && !controls.isLocked);
    const handRay = handInteraction?.hand
      ? handTracking?.getHandState?.(handInteraction.hand)?.raycaster
      : null;
    const mouseMode = controls.isLocked || (!arPinchActive && !handInteraction?.target);
    focusedTarget = mouseMode
      ? pointerTarget
      : (handInteraction?.target || handInteraction?.hoverTarget || pointerTarget);
    const handHolding = arPinchActive;
    updateExperimentIntentFocus(
      focusedTarget,
      mouseMode ? raycaster : (handRay || handInteraction?.raycaster || raycaster),
    );
    expManager.holdInteract(
      holdE || holdLMB || handHolding,
      t,
      dt,
      focusedTarget,
      mouseMode ? raycaster : (handRay || handInteraction?.raycaster || raycaster),
    );
    // Heavy integrate runs in frameCoordinator → simDriver.fixedUpdate.
    // update() only does light sync when simOwnedByDriver is set.
    expManager.update(t, dt, { simulate: false });
    // Desk thumbs follow live data even when content-screen HUD is throttled.
    if (expManager.state?.running && lastHudSnapshot?.running) {
      const sid = expManager.state.stationId;
      const panel = sid ? deskSliderPanels[sid] : null;
      if (panel?.userData?.present) {
        const data = expManager.state.data || {};
        const experiment = lastHudSnapshot.experiment;
        panel.userData.syncValues?.((spec) => readDeskSliderValue(spec, data, experiment));
      }
    }
    const focusedBoard = resolveSideBlackboardHost(focusedTarget);
    if (holdLMB && focusedBoard) {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      focusedBoard.userData.drawFromRay?.(raycaster);
    } else if (handHolding && focusedBoard) {
      // A solid AR pinch is the pen-down state. Keep sampling the locked
      // board every render frame instead of resetting the stroke while we
      // wait for the next (potentially slow) MediaPipe movement sample.
      const handState = handTracking?.getHandState(handInteraction?.hand);
      focusedBoard.userData.drawFromRay?.(handState?.raycaster);
    } else {
      sideBlackboards.forEach((board) => board.userData.stopStroke?.());
    }
    expManager.onFocus(focusedTarget);
    const hallRun = expManager.state.running && expManager.state.expId === 'hall_effect';
    const opticsRun = expManager.state.running
      && (expManager.state.expId === 'multi_slit_diffraction'
        || expManager.state.data?.mode === 'geometric');
    const canInteract = !!(
      focusedTarget
      || handInteraction?.holding
      || (hallRun && expManager.state.data?.hallDragging)
      || (hallRun && expManager.state.data?.tableScrollDrag?.armed)
      || (opticsRun && expManager.state.data?.dragging)
      || (hallRun && expManager.currentStep?.()?.id === 'identify')
    );

    if (focusedTarget !== _lastFocusedTarget) {
      _lastFocusedTarget = focusedTarget;
    }

    if (crosshair && canInteract !== _lastCrosshairCanInteract) {
      _lastCrosshairCanInteract = canInteract;
      if (canInteract) crosshair.classList.add('can-interact');
      else crosshair.classList.remove('can-interact');
    }
    updateAimHud(focusedTarget, canInteract);

    // Crosshair is centered via CSS (#crosshair: top 50%, left 50%).
  }

  // Room shell animators always; station animators only for the hot station.
  for (const fn of roomAnimators) {
    try { fn(t, dt); } catch { /* never let one room anim freeze the lab */ }
  }
  const hotStation = stationPresence?.getHotStation?.() || null;
  const hotAnims = hotStation ? stationAnimators[hotStation] : null;
  if (hotAnims) {
    for (const fn of hotAnims) {
      try { fn(t, dt); } catch { /* never let one station freeze the lab */ }
    }
  }

  const coordinatorStart = traceFrames ? performance.now() : 0;
  const coordinatorResult = frameCoordinator.frame(nowMs, { render: true });
  if (traceFrames) {
    const frameMs = performance.now() - frameTraceStart;
    if (frameMs > 100) {
      console.warn('[frame-trace]', JSON.stringify({
        frameMs: Number(frameMs.toFixed(1)),
        coordinatorMs: Number((performance.now() - coordinatorStart).toFixed(1)),
        renderMs: Number(coordinatorResult?.renderMs?.toFixed?.(1) || 0),
        running: !!expManager?.state?.running,
        expId: expManager?.state?.expId || null,
        softSwitch: !!labFrameScheduler.softSwitchActive?.(),
        gpuPrepareInProgress,
      }));
    }
  }
  performanceGovernor.setRuntimeInfo({
    workerMode: globalThis.__PHYSICS_BACKEND_MODE__ || 'auto',
    sharedArrayBuffer: globalThis.crossOriginIsolated === true,
    workerPending: labFrameScheduler.pending?.() || 0,
  });
  performanceGovernor.endFrame(performance.now());

  // One-shot HUD / attach work only — never block the next frame's sim.
} 

async function startExperimentSafe(expId) {
  if (!expId) return false;
  // Invalidate a pending idle showcase before preparing the selected runtime.
  // Otherwise its completion can hide the incoming apparatus after commit.
  stationShowcaseGeneration += 1;
  const found = findExperiment(expId);
  const stationId = found?.stationId || expManager?.state?.stationId;
  const switchLoader = beginExperimentSwitchLoader(found?.experiment?.name || expId);
  try {
    // Let the compositor paint the indicator before the first cold runtime
    // starts synchronous preparation / shader compilation.
    await nextPaint();
    const loadStart = performance.now();
    // Preview and automation callers can start from a cold manager state.
    // Establish the same station/menu contract as a terminal card click.
    if (stationId && (
      expManager?.state?.stationId !== stationId
      || !expManager?.state?.menuOpen
    )) {
      await openStationMenuSafe(stationId);
    }
    if (stationId) await ensureStationLoaded(stationId);
    console.log(`[open-trace] ensureStationLoaded dt=${(performance.now() - loadStart).toFixed(1)}ms`);
    switchLoader.setMessage(`正在准备 ${found?.experiment?.name || expId}…`);
    if (stationId) await ensureExperimentRuntimeLoaded(stationId, expId);
    console.log(`[open-trace] ensureExperimentRuntimeLoaded dt=${(performance.now() - loadStart).toFixed(1)}ms`);
  } catch (error) {
    showToast(`Unable to load ${stationId || 'experiment'}; retry`);
    console.warn('[lab] experiment load failed', error);
    switchLoader.end();
    return false;
  }
  try {
    const key = `${stationId || expManager?.state?.stationId || 'unknown'}:${expId}`;
    // A learner action takes priority over the post-entry background queue.
    // Cancel only that queue; the transition below performs the selected
    // experiment's compile exactly once and reuses any pending same-key job.
    await pauseBackgroundShaderWarmup();
    hideShaderWarmupIndicator();
    // A focused card may already be compiling this exact runtime. Reuse that
    // transaction so the click path waits for prepared GPU state instead of
    // presenting a half-warmed apparatus and paying the compile on the first
    // visible frame.
    const intentPrewarm = intentPrewarmPromises.get(key);
    if (intentPrewarm) await intentPrewarm.catch(() => false);
    // Prime the exact controls before compiling the real scene. This also
    // covers an immediate click that arrives before the 120 ms intent timer.
    primeExperimentChromeForWarmup(stationId, expId);
    switchLoader.setMessage(`正在编译 ${found?.experiment?.name || expId}…`);
    const transitionStart = performance.now();
    const transition = await experimentTransition.open(key, {
      stationId,
      expId,
    });
    console.log(`[open-trace] transition.open dt=${(performance.now() - transitionStart).toFixed(1)}ms`);
    if (!transition.committed) {
      if (!transition.cancelled && transition.error) {
        showToast('Unable to prepare experiment; retry');
        console.warn('[lab] experiment prepare failed', transition.error);
      }
      return false;
    }
    // Keep the old lab frame on screen while the runtime is mounted and the
    // manager applies its initial visual state. The manager commit is cheap,
    // but it changes material/maps and must happen before the final compile;
    // compiling first leaves those new variants for the first visible frame.
    gpuPrepareInProgress = true;
    let committed = false;
    try {
      ensureActiveApparatusVisible(stationId, expId, { includeChrome: true });
      const commitStart = performance.now();
      committed = (await expManager?.startExperiment?.(expId, { immediate: true })) !== false;
      console.log(`[open-trace] manager commit dt=${(performance.now() - commitStart).toFixed(1)}ms`);
      if (!committed) return false;

      switchLoader.setMessage(`正在完成 ${found?.experiment?.name || expId} 的图形编译…`);
      const sceneCompileStart = performance.now();
      try {
        await compileVisibleExperimentGpu(stationId, expId);
      } catch (error) {
        console.warn('[lab] visible scene compile failed; first frame will retry', error);
      }
      console.log(`[open-trace] visible scene compile dt=${(performance.now() - sceneCompileStart).toFixed(1)}ms`);

      // Upload the final active graph in small cooperative draws. A single
      // full-scene render here can block ANGLE for seconds; these 1×1 slices
      // keep the loader and input responsive while warming the same buffers.
      const drawWarmStart = performance.now();
      await prewarmVisibleSceneGpu(stationId, expId);
      console.log(`[open-trace] visible scene draw prewarm dt=${(performance.now() - drawWarmStart).toFixed(1)}ms`);

      // renderer.compile() does not touch the fullscreen materials owned by
      // EffectComposer. Warm those passes before the manager exposes the
      // experiment, so the first learner-visible frame is only a normal draw.
      const postWarmStart = performance.now();
      labPostProcessing?.prewarm?.();
      console.log(`[open-trace] postprocessing prewarm dt=${(performance.now() - postWarmStart).toFixed(1)}ms`);
    } finally {
      gpuPrepareInProgress = false;
    }
    if (committed) {
      preparedExperimentIds.add(expId);
      shaderWarmup.markComplete(key);
      if (stationId) {
        preparedExperimentSignatures.set(expId, JSON.stringify(warmInitData(stationId, expId)));
      }
      ensureActiveApparatusVisible(stationId, expId);
    }
    return committed !== false;
  } finally {
    labFrameScheduler.endSoftSwitch?.();
    switchLoader.end();
  }
}

/**
 * Reassert the host mount invariant after the legacy manager's visual commit.
 * The source runtimes own the apparatus graph; this only repairs a stale
 * async showcase/unmount parent and never rebuilds geometry.
 */
function ensureActiveApparatusVisible(stationId, expId, { includeChrome = false } = {}) {
  const entry = stationScenes[stationId];
  const equipmentForStation = entry?.equipment || equipment?.[stationId];
  if (!entry || !equipmentForStation || !expId) return false;
  if (entry.root?.parent !== scene) scene.add(entry.root);
  entry.root.visible = true;

  if (stationId === 'mechanics') {
    const runtime = equipmentForStation.sourceRuntimes?.[expId];
    if (!runtime?.root) return false;
    equipmentForStation.setMode?.(expId, null, { reset: false, snapshot: false });
    runtime.setVisible?.(true);
    const visible = runtime.root.parent === entry.root && runtime.root.visible === true;
    if (includeChrome) setActiveExperimentChromeVisible(stationId);
    return visible;
  }

  const ensured = equipmentForStation.ensureActiveRuntime?.(expId);
  if (ensured != null) {
    if (includeChrome) setActiveExperimentChromeVisible(stationId);
    return !!ensured;
  }

  if (includeChrome) setActiveExperimentChromeVisible(stationId);
  return true;
}

// The manager normally reveals these two graphs during its visual commit.
// Reveal them during the guarded GPU phase as well, so compileAsync and the
// composer see the same material set that the first active frame will see.
function setActiveExperimentChromeVisible(stationId) {
  deskSliderPanels?.[stationId]?.userData?.setPresent?.(true);
  stationDisplays?.[stationId]?.userData?.setPresent?.(true);
}

async function compileVisibleExperimentGpu(stationId, expId) {
  const entry = stationScenes[stationId];
  const equipmentForStation = entry?.equipment || equipment?.[stationId];
  if (!entry || !equipmentForStation) return;

  // Mechanics exposes one source-faithful root per experiment. Other legacy
  // stations keep their active mode under a shared station root, which is a
  // safe fallback because those modules are lazy-created at this point.
  const apparatusRoot = stationId === 'mechanics'
    ? equipmentForStation.sourceRuntimes?.[expId]?.root
    : entry.root;
  const roots = [
    apparatusRoot,
    deskSliderPanels?.[stationId],
    stationDisplays?.[stationId],
  ].filter((root, index, list) => root?.isObject3D && list.indexOf(root) === index);

  for (const root of roots) {
    root.updateWorldMatrix?.(true, true);
    if (typeof renderer?.compileAsync === 'function') {
      await renderer.compileAsync(root, camera, scene);
    } else {
      renderer?.compile?.(root, camera, scene);
    }
  }

  // The first present traverses the complete room, not only the active
  // apparatus. Compile that exact scene graph while the switch loader still
  // covers the canvas; otherwise static room materials that were not visible
  // during boot all link on the first post-commit frame and freeze it.
  scene.updateWorldMatrix?.(true, true);
  if (typeof renderer?.compileAsync === 'function') {
    await renderer.compileAsync(scene, camera, scene);
  } else {
    renderer?.compile?.(scene, camera, scene);
  }
}

async function prewarmVisibleSceneGpu(stationId, expId) {
  if (typeof renderer?.render !== 'function') return;

  if (!intentPrepareTarget && typeof THREE?.WebGLRenderTarget === 'function') {
    intentPrepareTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
    });
  }
  const target = intentPrepareTarget;
  if (!target) return;

  const previousTarget = renderer.getRenderTarget?.() || null;
  const previousAutoClear = renderer.autoClear;
  const previousShadowAutoUpdate = renderer.shadowMap?.autoUpdate;
  try {
    renderer.autoClear = true;
    renderer.setRenderTarget?.(target);
    if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget?.(previousTarget);
    renderer.autoClear = previousAutoClear;
    if (renderer.shadowMap && previousShadowAutoUpdate !== undefined) {
      renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
    }
  }
}

// Intent prediction owns the expensive first construction. The prepared root
// is rendered in a 1x1 target with the same renderer, then returned to its
// original parent before the user can activate the card.
let intentPrepareScene = null;
let intentPrepareCamera = null;
let intentPrepareTarget = null;
const intentPrewarmPromises = new Map();
let focusedExperimentKey = null;
let focusedExperimentTimer = 0;
let activeIntentPrewarm = null;

/**
 * Clone a display/control graph for shader preparation without copying its
 * live interaction bridge. These graphs keep Object3D references and
 * callbacks in userData (including self-references), while Three.js' default
 * Object3D.copy() serializes userData through JSON.stringify(). The prepare
 * scene only needs geometry, materials, and textures, so an empty userData is
 * the correct and safer representation for this offscreen clone.
 */
function cloneGpuPrepareGraph(source) {
  if (!source?.clone || !source?.traverse) return null;
  const userData = [];
  source.traverse((object) => {
    userData.push([object, object.userData]);
    object.userData = {};
  });
  try {
    return source.clone(true);
  } finally {
    userData.forEach(([object, value]) => {
      object.userData = value;
    });
  }
}

function ensureIntentPrepareScene() {
  if (intentPrepareScene) return intentPrepareScene;
  intentPrepareScene = new THREE.Scene();
  intentPrepareScene.name = 'experiment-intent-prepare';
  intentPrepareScene.background = null;
  // Compile against the room's light topology without rendering the room.
  scene.traverse((object) => {
    if (!object.isLight) return;
    const light = object.clone();
    if (object.target?.isObject3D) light.target = object.target.clone();
    intentPrepareScene.add(light);
  });
  // The desk control panel is revealed by the manager after the apparatus
  // commit. Include lightweight graph clones here so its material variants
  // are compiled in the same transaction; otherwise the experiment appears
  // ready and the panel's first frame still stalls on a second shader burst.
  Object.entries(deskSliderPanels).forEach(([stationId, panel]) => {
    const clone = cloneGpuPrepareGraph(panel);
    if (!clone) return;
    clone.name = `intent-warm-${stationId}-desk-sliders`;
    intentPrepareScene.add(clone);
  });
  Object.entries(stationDisplays).forEach(([stationId, display]) => {
    const clone = cloneGpuPrepareGraph(display);
    if (!clone) return;
    clone.name = `intent-warm-${stationId}-display`;
    intentPrepareScene.add(clone);
  });
  intentPrepareCamera = camera.clone();
  intentPrepareCamera.aspect = 1;
  intentPrepareCamera.updateProjectionMatrix();
  intentPrepareTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  return intentPrepareScene;
}

function beginExperimentIntentPrewarm(stationId, expId) {
  if (!stationId || !expId || expManager?.state?.running) return null;
  markUserIntent();
  const key = `${stationId}:${expId}`;
  const existing = intentPrewarmPromises.get(key);
  if (existing) return existing;
  activeIntentPrewarm = { key };
  // A stable card focus is already a strong user intent. Prepare the same
  // runtime used by the click path, including GPU compilation, while the
  // learner is still aiming at the card. The click then reuses this exact
  // transaction instead of paying the compile stall on activation.
  // Stop the catalog queue before compiling the focused experiment. WebGL
  // program compilation is not cancellable once ANGLE has entered it; letting
  // both jobs run together makes the selected experiment appear loaded while
  // the next background job is still blocking the first visible frame.
  const promise = pauseBackgroundShaderWarmup()
    .then(() => primeExperimentChromeForWarmup(stationId, expId))
    .then(() => ensureStationLoaded(stationId))
    .then(() => ensureExperimentRuntimeLoaded(stationId, expId))
    .then(() => experimentTransition.prewarm(key))
    .then((result) => {
      console.log(`[open-trace] intent prewarm key=${key} prepared=${!!result?.prepared} cached=${!!result?.cached}${result?.error ? ` error=${result.error?.message || result.error}` : ''}`);
      return !!result?.prepared;
    })
    .finally(() => {
      intentPrewarmPromises.delete(key);
      if (activeIntentPrewarm?.key === key) activeIntentPrewarm = null;
    });
  intentPrewarmPromises.set(key, promise);
  return promise;
}

/** Materialize hidden controls before GPU preparation, without showing them. */
function primeExperimentChromeForWarmup(stationId, expId) {
  const panel = deskSliderPanels?.[stationId];
  const experiment = findExperiment(expId)?.experiment;
  if (!panel?.userData || !experiment) return true;
  try {
    const { title, specs } = getDeskSliderConfig(stationId, expId, {}, experiment);
    panel.userData.setSpecs?.(specs, title);
  } catch (error) {
    console.warn('[shader-warmup] control material prepare failed', stationId, expId, error);
  }
  return true;
}

function cancelExperimentIntentPrewarm(exceptKey = null) {
  clearTimeout(focusedExperimentTimer);
  if (activeIntentPrewarm && activeIntentPrewarm.key !== exceptKey) {
    experimentTransition.cancelPrewarm(activeIntentPrewarm.key);
    activeIntentPrewarm = null;
  }
}

function scheduleExperimentIntentPrewarm(stationId, expId) {
  if (!stationId || !expId || expManager?.state?.running) return;
  markUserIntent();
  const key = `${stationId}:${expId}`;
  if (focusedExperimentKey === key || intentPrewarmPromises.has(key)) return;
  focusedExperimentKey = key;
  cancelExperimentIntentPrewarm(key);
  // Stable card focus starts the full runtime/GPU prewarm in the background;
  // it remains cancellable if the learner looks away before clicking.
  void ensureExperimentModuleLoaded(stationId, expId).catch(() => {});
  focusedExperimentTimer = setTimeout(() => {
    if (focusedExperimentKey !== key || expManager?.state?.running) return;
    beginExperimentIntentPrewarm(stationId, expId);
  }, 120);
}

function updateExperimentIntentFocus(target, inputRaycaster) {
  if (!target || expManager?.state?.running || !expManager?.state?.menuOpen) {
    focusedExperimentKey = null;
    cancelExperimentIntentPrewarm();
    return;
  }
  const screen = resolveScreenHost(target) || target;
  const stationId = screen?.userData?.stationId;
  const pick = screen?.userData?.pickFromRay?.(inputRaycaster);
  if (pick?.action === 'start' && pick.expId) {
    scheduleExperimentIntentPrewarm(stationId, pick.expId);
  } else {
    focusedExperimentKey = null;
    cancelExperimentIntentPrewarm();
  }
}

async function openStationMenuSafe(stationId) {
  if (!stationId) return false;
  markUserIntent();
  const generation = ++stationShowcaseGeneration;
  try { localStorage.setItem('lab:last-station', stationId); } catch { /* optional */ }
  // Menu state is metadata-only. Start the station scene load in the
  // background so the terminal responds immediately; experiment handlers load
  // only on card focus / start (authoritative await in startExperimentSafe).
  expManager?.openStationMenu?.(stationId);
  void ensureStationLoaded(stationId)
    .then(() => revealStationShowcase(stationId, generation))
    .catch((error) => {
      showToast(`Unable to load ${stationId}; retry`);
      console.warn('[lab] station load failed', error);
    });
  return true;
}

// Camera presets are used only by explicit preview/chem startup flows. Opening
// a station menu must not call this helper: the menu is a UI action and should
// never move the learner's position or view.
function focusStationForMenu(stationId) {
  const preset = {
    mechanics: { position: [-4.2, 1.75, 0.35], target: [-4.2, 1.18, -2.8] },
    optics: { position: [4.15, 1.55, -1.15], target: [4.2, 1.02, -2.8] },
    electro: { position: [-4.0, 1.45, 3.65], target: [-4.0, 1.12, 2.55] },
    thermo: { position: [4.2, 1.6, 4.9], target: [4.2, 1.28, 2.6] },
  }[stationId];
  if (!preset) return false;
  const position = new THREE.Vector3().fromArray(preset.position);
  // Do not interrupt a learner who is already at this station. This also
  // keeps keyboard/mouse navigation continuous when switching cards nearby.
  if (camera.position.distanceTo(position) <= 3.6) return false;
  camera.position.copy(position);
  camera.lookAt(new THREE.Vector3().fromArray(preset.target));
  return true;
}

/**
 * Predictive station preload is intent-only: stable camera gaze or terminal
 * focus after the user is already in the room. Cold boot never preloads
 * last-station, Cannon, MediaPipe, GLTF, or PMREM.
 */
const stationPredictionPoints = Object.freeze({
  mechanics: new THREE.Vector3(-4.2, 1, -2.8),
  optics: new THREE.Vector3(4.2, 1, -2.8),
  electro: new THREE.Vector3(-4.2, 1, 2.6),
  thermo: new THREE.Vector3(4.2, 1, 2.6),
});
const stationPredictionDirection = new THREE.Vector3();
const stationPredictionVector = new THREE.Vector3();
let predictedStation = null;
let predictedSince = 0;
const predictedStations = new Set();

function predictStationPreload(nowMs) {
  // No station chunk requests until the learner has shown intent (move/look/menu).
  if (!userIntentSeen || webglContextLost) return;
  camera.getWorldDirection(stationPredictionDirection);
  let candidate = null;
  for (const [stationId, point] of Object.entries(stationPredictionPoints)) {
    stationPredictionVector.copy(point).sub(camera.position);
    if (stationPredictionVector.length() <= 3
      && stationPredictionVector.normalize().dot(stationPredictionDirection) > 0.05) {
      candidate = stationId;
      break;
    }
  }
  if (candidate !== predictedStation) {
    predictedStation = candidate;
    predictedSince = nowMs;
    return;
  }
  if (candidate && nowMs - predictedSince >= 250 && !predictedStations.has(candidate)) {
    predictedStations.add(candidate);
    preloadStation(candidate).catch(() => {});
  }
}

/**
 * Reset the laboratory session without destroying the WebGL context.
 * This is the desktop-safe equivalent of restarting the lab: GPU programs,
 * renderer caches and prepared runtimes remain owned by the current window.
 */
async function softRestartLab() {
  if (labRuntimeDisposed || webglContextLost) return false;
  await pauseBackgroundShaderWarmup();
  controls.unlock();
  resetTouchStick();
  move.up = false;
  move.down = false;
  velocity.set(0, 0, 0);
  direction.set(0, 0, 0);
  arVelocity.set(0, 0);
  clearTouchMove();
  closeHoloFullscreen();
  expManager?.cancelPendingStart?.();
  if (expManager?.state?.running || expManager?.state?.menuOpen) {
    expManager?.closeStationUi?.();
  } else {
    expManager?.closeMenu?.();
    stationPresence?.setHotStation?.(null);
  }

  camera.position.set(-4.2, 1.65, 4.7);
  camera.lookAt(-4.2, 1.28, 0);
  camera.updateMatrixWorld(true);
  updateAimHud(null, false);
  resetMouseDragAccum();
  labFrameScheduler.clear();
  frameCoordinator.cancelAll();
  frameCoordinator.reset?.();
  frameCoordinator.invalidate();
  requestShadowRefresh();
  showToast('实验室已重新开始 · 已复用图形缓存');

  // Resume post-entry compilation only while no experiment is active. The
  // current renderer/cache are intentionally left untouched.
  void startBackgroundShaderWarmup();
  return true;
}

mountUi({
  bridge: {
    prepareExperiment,
    openStationMenu: (stationId) => openStationMenuSafe(stationId),
    closeMenu: () => expManager?.closeMenu(),
    startExperiment: (expId) => startExperimentSafe(expId),
    exitExperiment: () => expManager?.exitExperiment(),
    uiAction: (action, payload) => expManager?.uiAction(action, payload),
    recordExperiment: () => expManager?.onKey('KeyF', clock.elapsedTime),
    triggerExperimentAction: () => expManager?.interact({ userData: { role: 'ui_action' } }, clock.elapsedTime),
    toggleHandTracking,
    openHelpModal,
    closeHelpModal,
    toggleHelpModal,
    openFullscreen: (stationId) => openHoloFullscreen(stationId),
    closeFullscreen: () => closeHoloFullscreen(),
    restartLab: () => softRestartLab(),
  },
});

// Start render loop immediately so frames under the loader are real lab content
// (loader fully covers the canvas until finish()).
animate();

// ── Boot gate: room shell ready before the lab is revealed (no full-lab warm) ──
const bootStarted = performance.now();
const MIN_BOOT_MS = 500;

/** Restore the default framebuffer to the full canvas drawing buffer. */
function restoreLabFramebuffer() {
  // Always re-assert drawing buffer from the live canvas layout box. A prior
  // 1×1 offscreen warm (or a disposed RT) can leave the viewport broken so
  // only MeshBasic holos survive until the next setSize; also re-sync aspect
  // so windowed mode does not stay anamorphically stretched vs fullscreen.
  const pr = Math.max(renderer.getPixelRatio?.() || window.devicePixelRatio || 1, 1);
  const { width: cssW, height: cssH } = applyLabViewportSize({
    updateCamera: true,
    pixelRatio: pr,
  });
  renderer.setRenderTarget(null);
  // Three.js setViewport/setScissor take *logical* CSS pixels and multiply by
  // pixelRatio internally. Passing cssW*pr (physical) double-scales the GL
  // viewport — the scene no longer fills the canvas, crosshair stays CSS-centered,
  // and picks feel permanently offset (esp. Vite dev after 1×1 intent prewarm;
  // F11 only "fixed" it by running setSize which resets the viewport correctly).
  renderer.setViewport(0, 0, cssW, cssH);
  if (renderer.setScissorTest) renderer.setScissorTest(false);
  if (renderer.setScissor) renderer.setScissor(0, 0, cssW, cssH);
  const fullW = Math.max(1, Math.floor(cssW * pr));
  const fullH = Math.max(1, Math.floor(cssH * pr));
  return { fullW, fullH, pr, cssW, cssH };
}

/** Present a few frames so the first visible image is the lab, not an empty buffer. */
async function paintReadyFrames() {
  labLoader.setProgress(0.92, '渲染首帧…');
  const firstFrameT0 = performance.now();
  // Skip the 1×1 offscreen warm entirely. In Vite dev it repeatedly left the
  // default framebuffer / viewport in a broken state (GL zero-size attachment
  // errors every frame; only MeshBasic holos + blackboards remained visible).
  // Production builds happened to recover on the first experiment prepare's
  // setSize, which is why `npm run build` looked fine.
  // Layout may have settled under the loader; remeasure client box before first paint.
  resizeRendererViewport();
  restoreLabFramebuffer();
  try {
    renderer.clear?.();
    // Force a shadow map fill so the first visible frame has contact shadows.
    renderer.shadowMap.needsUpdate = true;
    if (labPostProcessing) labPostProcessing.render();
    else renderer.render(scene, camera);
  } catch { /* animate() will keep trying */ }

  labPerfStats.firstFrameMs = Number((performance.now() - firstFrameT0).toFixed(2));
  bootSuspendRender = false;
  labLoader.setProgress(0.96, 'Interactive room ready');
}

async function bootReveal() {
  try {
    // Portrait requests begin when the room graph is created, but do not block
    // boot on their decode/upload. Experiment shader work starts only after
    // the room is interactive, never while the boot loader is visible.
    await yieldToBrowser(8);
    labLoader.setProgress(0.55, '组装实验室房间…');
    await yieldToBrowser(8);
    labLoader.setProgress(0.78, 'Interactive room ready');
    document.body.classList.remove('is-loading');
    await paintReadyFrames();

    const wait = Math.max(0, MIN_BOOT_MS - (performance.now() - bootStarted));
    if (wait) await new Promise((r) => setTimeout(r, wait));

    labLoader.setProgress(1, '系统就绪 · 欢迎进入实验室');
    await labLoader.finish();
    labPerfStats.bootMs = Number((performance.now() - bootStarted).toFixed(2));

    if (window.__labDebug) {
      Object.assign(window.__labDebug, labPerfSnapshot());
    }
  } catch (err) {
    console.warn('[boot] reveal failed', err);
    bootSuspendRender = false;
    try {
      await paintReadyFrames();
    } catch { /* ignore */ }
    try {
      await labLoader.finish();
    } catch { /* ignore */ }
    labPerfStats.bootMs = Number((performance.now() - bootStarted).toFixed(2));
  }
}

bootReveal();
