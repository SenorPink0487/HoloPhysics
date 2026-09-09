import * as THREE from 'three';
import {
  OCCLUSION_HOLD_MS,
  HandInteractionArbiter,
  KalmanAimFilter2D,
  MedianFilterScalar,
  OneEuroScalar,
  OneEuroVector3,
  PinchStateMachine,
  WorkerRecoveryPolicy,
  applyPinchContactConstraint,
  assignHandTracks,
  distance3,
  estimatePalmCenter,
  estimateProjectedHandDepth,
  estimatePinchRatio,
  isOpenPalm,
  mapVideoPointToViewportNdc,
  mapMediaPipeToXR,
  occlusionOpacity,
  selectPrimaryHandDetections,
} from './handPoseMath.js';

// Keep AR assets out of the bootstrap dependency graph. These files are copied
// into the desktop/web asset tree so the same URLs work in Tauri offline mode.
const MEDIAPIPE_WASM_LOADER = '/assets/mediapipe/wasm/vision_wasm_module_internal.js';
const MEDIAPIPE_WASM_BINARY = '/assets/mediapipe/wasm/vision_wasm_module_internal.wasm';

const HAND_COLORS = {
  Left: 0x67e8f9,
  Right: 0x67e8f9,
};
const PINCH_CURSOR_COLOR = 0xfbbf24;

const XR_HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

const XR_JOINT_NEXT = [
  10,
  2, 3, 4, -1,
  6, 7, 8, 9, -1,
  11, 12, 13, 14, -1,
  16, 17, 18, 19, -1,
  21, 22, 23, 24, -1,
];

const XR_JOINT_PREV = [
  -1,
  0, 1, 2, 3,
  0, 5, 6, 7, 8,
  0, 10, 11, 12, 13,
  0, 15, 16, 17, 18,
  0, 20, 21, 22, 23,
];

const NORMAL_INFERENCE_INTERVAL = 1000 / 60;
const SLOW_INFERENCE_INTERVAL = 1000 / 30;
const FALLBACK_INFERENCE_INTERVAL = 1000 / 15;
const RENDER_RESPONSE_PER_SECOND = 80;
const DRAG_DEAD_ZONE_PX = 3;
const MAX_DRAG_DELTA_PX = 60;
const HOVER_SWITCH_MS = 60;
const HOVER_HOLD_MS = 100;
const WORKER_FRAME_TIMEOUT_MS = 750;
const BASE_HAND_OPACITY = 0.8;
const BASE_HAND_EMISSIVE = 0.3;
const THUMB_TIP_JOINT_INDEX = 4;
const INDEX_TIP_JOINT_INDEX = 9;
const SOURCE_INDEX_TIP_INDEX = 8;
// Keep owner continuity long enough to reject a crossing bystander, but do not
// suppress the real user's reacquired hand for more than a fraction of a
// second after a quick movement or brief occlusion.
const PRIMARY_HAND_LOCK_TIMEOUT_MS = 650;
const PRIMARY_HAND_CONTINUITY_MS = 500;
const PRIMARY_HAND_REACQUIRE_DISTANCE = 0.55;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function flattenLandmarks(landmarks = []) {
  const values = new Float32Array(landmarks.length * 3);
  landmarks.forEach(({ x, y, z }, index) => {
    const offset = index * 3;
    values[offset] = x;
    values[offset + 1] = y;
    values[offset + 2] = z;
  });
  return values;
}

function serializeMainThreadResult(result) {
  const landmarks = result?.landmarks || [];
  const worldLandmarks = result?.worldLandmarks || [];
  const handedness = result?.handedness || result?.handednesses || [];
  return landmarks.map((points, index) => ({
    label: handedness[index]?.[0]?.categoryName || null,
    score: Number(handedness[index]?.[0]?.score) || 0,
    landmarks: flattenLandmarks(points),
    worldLandmarks: flattenLandmarks(worldLandmarks[index]),
  }));
}

function unpackLandmarks(values, output) {
  const count = Math.min(output.length, Math.floor((values?.length || 0) / 3));
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    output[index].set(values[offset], values[offset + 1], values[offset + 2]);
  }
  return count;
}

function createHandVisual(camera, color) {
  const group = new THREE.Group();
  group.visible = false;
  camera.add(group);

  const tipMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), tipMaterial);
  tip.frustumCulled = false;
  tip.renderOrder = 1002;
  group.add(tip);

  return {
    group,
    tip,
    tipMaterial,
    color,
    handModel: null,
    handMaterials: [],
    hologramUniforms: [],
    modelBones: [],
    modelRest: [],
    bindPositions: [],
    restPalmNormal: new THREE.Vector3(),
  };
}

function configureHolographicMaterial(material, color, phase) {
  const uniforms = {
    holoTime: { value: 0 },
    holoColor: { value: new THREE.Color(color) },
    holoPhase: { value: phase },
  };
  material.userData.hologramUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float holoTime;
uniform vec3 holoColor;
uniform float holoPhase;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float holoFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
float holoRim = pow(max(0.0, 1.0 - holoFacing), 2.15);
float holoScan = 0.5 + 0.5 * sin(gl_FragCoord.y * 0.72 - holoTime * 7.0 + holoPhase);
float holoPulse = 0.84 + 0.16 * sin(holoTime * 2.4 + holoPhase);
outgoingLight += holoColor * (holoRim * 0.72 + holoScan * 0.075) * holoPulse;
diffuseColor.a *= mix(0.76, 1.0, holoRim) * (0.92 + holoScan * 0.08);
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'tracked-hand-hologram-v1';
  return uniforms;
}

function updateHologram(visual, nowMs) {
  const seconds = nowMs * 0.001;
  visual.hologramUniforms.forEach((uniforms) => {
    uniforms.holoTime.value = seconds;
  });
}

function setVisualOpacity(visual, opacity) {
  const clamped = THREE.MathUtils.clamp(opacity, 0, 1);
  visual.group.visible = clamped > 0;
  visual.handMaterials.forEach((material) => {
    material.opacity = BASE_HAND_OPACITY * clamped;
    material.emissiveIntensity = BASE_HAND_EMISSIVE * Math.max(clamped, 0.12);
  });
  visual.tipMaterial.opacity = 0.9 * clamped;
}

function disposeVisual(visual) {
  visual.handModel?.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });
  visual.group.removeFromParent();
  visual.tip.geometry.dispose();
  visual.tipMaterial.dispose();
}

/**
 * Laptop-camera dual-hand input for the Three.js lab. Both hands are rendered
 * and may pinch independently so AR can support dual-hand dolly navigation.
 */
export function createHandTracking({
  camera,
  scene,
  video,
  resolveTarget,
  onPinchStart,
  onPinchMove,
  onPinchEnd,
  onStatus,
}) {
  if (!camera.parent) scene.add(camera);

  const states = ['Left', 'Right'].map((label) => ({
    label,
    visual: createHandVisual(camera, HAND_COLORS[label]),
    raycaster: new THREE.Raycaster(),
    rigTargets: Array.from({ length: 25 }, () => new THREE.Vector3()),
    poseFilters: Array.from({ length: 21 }, () => new OneEuroVector3({
      minCutoff: 3.2,
      beta: 0.55,
      dCutoff: 1.5,
    })),
    depthFilter: new OneEuroScalar({ minCutoff: 1.5, beta: 0.25, dCutoff: 1 }),
    aimFilter: new KalmanAimFilter2D(),
    pinchMedian: new MedianFilterScalar(1),
    sampleLandmarks: Array.from({ length: 21 }, () => new THREE.Vector3()),
    sampleWorldLandmarks: Array.from({ length: 21 }, () => new THREE.Vector3()),
    poseTargets: Array.from({ length: 21 }, () => new THREE.Vector3()),
    renderPose: Array.from({ length: 21 }, () => new THREE.Vector3()),
    renderPoseInitialized: false,
    aimSample: new THREE.Vector3(),
    aimTarget: new THREE.Vector2(),
    palmSample: new THREE.Vector3(),
    palmNdc: new THREE.Vector2(),
    openPalm: false,
    lastRenderAt: -Infinity,
    // MediaPipe occasionally reports one wide thumb/index sample during an
    // otherwise held pinch. A short release dwell prevents that blip from
    // ending and restarting an AR drag (which appears as dotted writing).
    // HoloMath uses 0.045 / 0.06 in image space. Normalizing by a typical
    // palm width maps those thresholds to roughly 0.30 / 0.40 here.
    pinch: new PinchStateMachine({
      enterThreshold: 0.30,
      exitThreshold: 0.40,
      exitGraceMs: 60,
    }),
    poseInitialized: false,
    visible: false,
    trackingVisible: false,
    pinching: false,
    suppressed: false,
    lastSeenAt: -Infinity,
    lastWrist: null,
    handednessScore: 0,
    pendingPinchRatio: null,
    pendingRawPinchRatio: null,
    rawPinchRatio: Infinity,
    filteredPinchRatio: Infinity,
    lastNdc: new THREE.Vector2(),
    ndc: new THREE.Vector2(),
    cursorNdc: new THREE.Vector2(),
    cursorWorld: new THREE.Vector3(),
    dragResidual: new THREE.Vector2(),
    hoverTarget: null,
    hoverCandidate: null,
    hoverCandidateSince: -Infinity,
    lastHoverAt: -Infinity,
    liveTarget: null,
    lockedTarget: null,
  }));

  const arbiter = new HandInteractionArbiter();
  let active = false;
  let starting = false;
  let stream = null;
  let handModelsPromise = null;
  let worker = null;
  let workerBusy = false;
  let inflightFrameId = 0;
  let nextFrameId = 1;
  let workerFrameTimer = 0;
  let recoveringWorker = false;
  let capturePending = false;
  let fallbackLandmarker = null;
  let fallbackStarting = false;
  let mainThreadInference = false;
  let degraded = false;
  let lastVideoTime = -1;
  let lastInferenceAt = 0;
  // This is a continuity-based owner lock, not person/biometric recognition.
  // It keeps a bystander's hand from taking over while the active user is
  // briefly occluded or moves one hand out of frame.
  let lastPrimarySeenAt = -Infinity;
  let detectedHands = 0;
  let trackingFps = 0;
  let inferenceMs = 0;
  let pipelineMs = 0;
  let droppedFrames = 0;
  let workerRestarts = 0;
  let workerDelegate = 'CPU';
  let dropRate = 0;
  let adaptiveInterval = NORMAL_INFERENCE_INTERVAL;
  let fastInferenceSince = 0;
  let lastMetricStatusAt = 0;
  const inferenceSamples = [];
  const pipelineSamples = [];
  const resultTimes = [];
  const recentFrameOutcomes = [];
  const recoveryPolicy = new WorkerRecoveryPolicy();

  const frameY = new THREE.Vector3();
  const frameZ = new THREE.Vector3();
  const frameX = new THREE.Vector3();
  const frameTemp = new THREE.Vector3();
  const frameMatrix = new THREE.Matrix4();
  const targetFrame = new THREE.Quaternion();
  const frameDelta = new THREE.Quaternion();
  const targetPalmNormal = new THREE.Vector3();
  const wristAnchor = new THREE.Vector3();
  const projectedPalmA = new THREE.Vector3();
  const projectedPalmB = new THREE.Vector3();

  const notify = (phase, detail = '') => onStatus?.({
    phase,
    detail,
    active,
    detectedHands,
    activeHand: arbiter.activeHand,
    trackingFps,
    inferenceMs,
    pipelineMs,
    droppedFrames,
    workerRestarts,
    workerDelegate,
    dropRate,
    pinchRatios: Object.fromEntries(states.map((state) => [state.label, {
      raw: state.rawPinchRatio,
      filtered: state.filteredPinchRatio,
      pinching: state.pinch.pinching,
    }])),
    degraded,
  });

  function getPalmNormal(positions, out) {
    frameX.copy(positions[5]).sub(positions[20]);
    frameY.copy(positions[10]).sub(positions[0]);
    out.crossVectors(frameX, frameY);
    if (out.lengthSq() < 1e-8) out.set(0, 0, 1);
    else out.normalize();
    return out;
  }

  function getJointFrame(positions, index, palmPlaneNormal, out) {
    const next = XR_JOINT_NEXT[index];
    const previous = XR_JOINT_PREV[index];
    if (next >= 0) frameY.copy(positions[next]).sub(positions[index]);
    else if (previous >= 0) frameY.copy(positions[index]).sub(positions[previous]);
    else frameY.set(0, 1, 0);
    if (frameY.lengthSq() < 1e-8) frameY.set(0, 1, 0);
    else frameY.normalize();

    frameZ.copy(palmPlaneNormal).addScaledVector(frameY, -palmPlaneNormal.dot(frameY));
    if (frameZ.lengthSq() < 1e-8) {
      frameTemp.set(Math.abs(frameY.z) < 0.9 ? 0 : 1, 0, Math.abs(frameY.z) < 0.9 ? 1 : 0);
      frameZ.copy(frameTemp).addScaledVector(frameY, -frameTemp.dot(frameY));
    }
    frameZ.normalize();
    frameX.crossVectors(frameY, frameZ).normalize();
    frameZ.crossVectors(frameX, frameY).normalize();
    frameMatrix.makeBasis(frameX, frameY, frameZ);
    return out.setFromRotationMatrix(frameMatrix);
  }

  async function loadHandModel(state) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(`/assets/hands/${state.label.toLowerCase()}.glb`, (gltf) => {
        const model = gltf.scene.children[0] || gltf.scene;
        model.name = `${state.label.toLowerCase()}-tracked-hand`;
        model.traverse((object) => {
          if (!object.isMesh) return;
          object.geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({
            color: state.visual.color,
            roughness: 0.24,
            metalness: 0.12,
            emissive: state.visual.color,
            emissiveIntensity: BASE_HAND_EMISSIVE,
            transparent: true,
            opacity: BASE_HAND_OPACITY,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false,
            dithering: true,
          });
          const hologramUniforms = configureHolographicMaterial(
            material,
            state.visual.color,
            state.label === 'Left' ? 0 : Math.PI,
          );
          object.material = material;
          object.frustumCulled = false;
          object.renderOrder = 2;
          state.visual.handMaterials.push(material);
          state.visual.hologramUniforms.push(hologramUniforms);
        });

        const bones = XR_HAND_JOINTS.map((name) => model.getObjectByName(name));
        if (bones.some((bone) => !bone)) {
          reject(new Error(`Incomplete ${state.label} hand rig`));
          return;
        }
        const restPositions = bones.map((bone) => bone.position.clone());
        getPalmNormal(restPositions, state.visual.restPalmNormal);
        state.visual.modelRest = bones.map((bone, index) => {
          const frame = getJointFrame(
            restPositions,
            index,
            state.visual.restPalmNormal,
            new THREE.Quaternion(),
          );
          return {
            quaternion: bone.quaternion.clone(),
            frameInverse: frame.clone().invert(),
          };
        });
        state.visual.bindPositions = restPositions.map(({ x, y, z }) => ({ x, y, z }));
        state.visual.modelBones = bones;
        state.visual.handModel = model;
        state.visual.group.add(model);
        resolve(model);
      }, undefined, reject);
    });
  }

  function ensureHandModels() {
    if (!handModelsPromise) {
      handModelsPromise = Promise.all(states.map((state) => loadHandModel(state)));
    }
    return handModelsPromise;
  }

  function updateSkinnedHand(state, mapped) {
    const { handModel, modelBones, modelRest } = state.visual;
    if (!handModel || modelBones.length !== 25) return false;
    if (mapped !== state.rigTargets) {
      mapped.forEach((point, index) => state.rigTargets[index].set(point.x, point.y, point.z));
    }
    getPalmNormal(state.rigTargets, targetPalmNormal);
    modelBones.forEach((bone, index) => {
      const rest = modelRest[index];
      getJointFrame(state.rigTargets, index, targetPalmNormal, targetFrame);
      frameDelta.copy(targetFrame).multiply(rest.frameInverse);
      bone.position.copy(state.rigTargets[index]);
      bone.quaternion.copy(frameDelta).multiply(rest.quaternion);
    });
    return true;
  }

  function viewportCssSize() {
    // Match labShell: NDC must be relative to the WebGL canvas box, not
    // window.inner* (iframe / title-bar / non-fullscreen stretch).
    const el = typeof document !== 'undefined' ? document.getElementById('c') : null;
    const width = el?.clientWidth > 1 ? el.clientWidth : (window.innerWidth || 1280);
    const height = el?.clientHeight > 1 ? el.clientHeight : (window.innerHeight || 720);
    return { width, height };
  }

  function cameraPointToNdc(landmark, output = new THREE.Vector3()) {
    const { width, height } = viewportCssSize();
    return mapVideoPointToViewportNdc(landmark, {
      videoWidth: video.videoWidth || 1280,
      videoHeight: video.videoHeight || 720,
      viewportWidth: width,
      viewportHeight: height,
      mirrorX: true,
    }, output);
  }

  function localAtScreenPoint(landmark, depth, output = new THREE.Vector3()) {
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * depth;
    const projected = cameraPointToNdc(landmark, projectedPalmA);
    return output.set(
      projected.x * halfHeight * camera.aspect,
      projected.y * halfHeight,
      -depth,
    );
  }

  function getAimNdc(state, landmarks) {
    const thumbTip = landmarks[THUMB_TIP_JOINT_INDEX];
    const indexTip = landmarks[SOURCE_INDEX_TIP_INDEX];
    state.aimSample.set(
      (thumbTip.x + indexTip.x) * 0.5,
      (thumbTip.y + indexTip.y) * 0.5,
      0,
    );
    return cameraPointToNdc(state.aimSample, state.aimSample);
  }

  function resetPoseFilters(state, points, depth, aimNdc, sampleTimestamp) {
    state.poseFilters.forEach((filter, index) => {
      filter.reset(points[index], sampleTimestamp, state.poseTargets[index]);
    });
    state.depthFilter.reset(depth, sampleTimestamp);
    const gatedAim = state.aimFilter.reset(aimNdc, sampleTimestamp, state.aimSample);
    state.aimTarget.set(gatedAim.x, gatedAim.y);
    state.poseInitialized = true;
  }

  function updatePoseSample(state, landmarks, worldLandmarks, hasWorldPose, sampleTimestamp) {
    cameraPointToNdc(landmarks[5], projectedPalmA);
    cameraPointToNdc(landmarks[17], projectedPalmB);
    const dx = (projectedPalmA.x - projectedPalmB.x) * 0.5;
    const dy = (projectedPalmA.y - projectedPalmB.y) * 0.5;
    const worldPalmWidth = hasWorldPose
      ? Math.max(distance3(worldLandmarks[5], worldLandmarks[17]), 0.025)
      : 0.075;
    const rawDepth = estimateProjectedHandDepth({
      normalizedDeltaX: dx,
      normalizedDeltaY: dy,
      worldPalmWidth,
      cameraAspect: camera.aspect,
      cameraFovDeg: camera.fov,
    });
    const depth = state.poseInitialized
      ? state.depthFilter.filter(rawDepth, sampleTimestamp)
      : rawDepth;
    localAtScreenPoint(landmarks[0], depth, wristAnchor);

    const points = state.poseTargets;
    if (hasWorldPose) {
      const worldWrist = worldLandmarks[0];
      worldLandmarks.forEach((landmark, index) => {
        points[index].set(
          wristAnchor.x - (landmark.x - worldWrist.x),
          wristAnchor.y - (landmark.y - worldWrist.y),
          wristAnchor.z + (landmark.z - worldWrist.z),
        );
      });
    } else {
      const wristZ = landmarks[0].z || 0;
      landmarks.forEach((landmark, index) => {
        const point = localAtScreenPoint(landmark, depth, points[index]);
        point.z += (landmark.z - wristZ) * 0.42;
      });
    }

    const aimNdc = getAimNdc(state, landmarks);
    if (!state.poseInitialized) {
      resetPoseFilters(state, points, depth, aimNdc, sampleTimestamp);
    } else {
      state.poseFilters.forEach((filter, index) => {
        filter.filter(points[index], sampleTimestamp, state.poseTargets[index]);
      });
      const gatedAim = state.aimFilter.filter(
        aimNdc,
        sampleTimestamp,
        state.handednessScore,
        state.aimSample,
      );
      state.aimTarget.set(gatedAim.x, gatedAim.y);
    }
  }

  function renderFilteredPose(state, responseAlpha) {
    state.poseTargets.forEach((target, index) => {
      if (state.renderPoseInitialized) state.renderPose[index].lerp(target, responseAlpha);
      else state.renderPose[index].copy(target);
    });
    state.renderPoseInitialized = true;

    const mapped = mapMediaPipeToXR(
      state.renderPose,
      state.visual.bindPositions,
      state.rigTargets,
    );
    applyPinchContactConstraint(
      mapped,
      state.pinch.pinching ? state.filteredPinchRatio : Infinity,
    );
    updateSkinnedHand(state, mapped);
    state.visual.tip.position
      .copy(state.rigTargets[THUMB_TIP_JOINT_INDEX])
      .lerp(state.rigTargets[INDEX_TIP_JOINT_INDEX], 0.5);
    state.visual.group.visible = true;
    setVisualOpacity(state.visual, 1);
  }

  function updateHoverTarget(state, nextTarget, nowMs) {
    if (nextTarget === state.hoverTarget) {
      if (nextTarget) state.lastHoverAt = nowMs;
      state.hoverCandidate = null;
      return;
    }
    if (!nextTarget) {
      state.hoverCandidate = null;
      if (nowMs - state.lastHoverAt >= HOVER_HOLD_MS) state.hoverTarget = null;
      return;
    }
    if (!state.hoverTarget) {
      state.hoverTarget = nextTarget;
      state.lastHoverAt = nowMs;
      state.hoverCandidate = null;
      return;
    }
    if (state.hoverCandidate !== nextTarget) {
      state.hoverCandidate = nextTarget;
      state.hoverCandidateSince = nowMs;
      return;
    }
    if (nowMs - state.hoverCandidateSince >= HOVER_SWITCH_MS) {
      state.hoverTarget = nextTarget;
      state.lastHoverAt = nowMs;
      state.hoverCandidate = null;
    }
  }

  function resolveLiveTarget(targetInfo) {
    if (!targetInfo) return null;
    // resolveTarget may return either a mesh or { target, distance }.
    // Important: { target: null, distance } must stay null, not the wrapper object —
    // otherwise empty-space pinches are treated as equipment grabs and look is blocked.
    if (Object.prototype.hasOwnProperty.call(targetInfo, 'target')) {
      return targetInfo.target || null;
    }
    return targetInfo;
  }

  function updateRayFromVisualCursor(state) {
    // Prefer the visible fingertip cursor when it projects cleanly in front of
    // the camera. If the skinned hand tip is still at the camera origin (model
    // not ready / depth collapse), fall back to the filtered MediaPipe aim so
    // AR clicks still land on menus and apparatus.
    state.visual.tip.updateWorldMatrix(true, false);
    state.visual.tip.getWorldPosition(state.cursorWorld);
    const camSpaceZ = state.cursorWorld.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const tipUsable = Number.isFinite(camSpaceZ) && camSpaceZ < -0.08;
    if (tipUsable) {
      state.cursorWorld.project(camera);
      if (Number.isFinite(state.cursorWorld.x) && Number.isFinite(state.cursorWorld.y)) {
        state.cursorNdc.set(
          THREE.MathUtils.clamp(state.cursorWorld.x, -1, 1),
          THREE.MathUtils.clamp(state.cursorWorld.y, -1, 1),
        );
      } else if (state.aimTarget) {
        state.cursorNdc.copy(state.aimTarget);
      }
    } else if (state.aimTarget && Number.isFinite(state.aimTarget.x)) {
      state.cursorNdc.copy(state.aimTarget);
    } else if (state.palmNdc && Number.isFinite(state.palmNdc.x)) {
      state.cursorNdc.copy(state.palmNdc);
    }
    // AR navigation reads state.ndc for single-hand look and dual-hand dolly.
    state.ndc.copy(state.cursorNdc);
    state.raycaster.setFromCamera(state.cursorNdc, camera);
    const targetInfo = resolveTarget?.(state.raycaster, state.label, state.cursorNdc) || null;
    state.liveTarget = resolveLiveTarget(targetInfo);
  }

  function renderTrackedState(state, nowMs) {
    if (!state.poseInitialized || !state.trackingVisible) return;
    state.aimFilter.predict(nowMs, state.aimTarget);
    const elapsedSeconds = Number.isFinite(state.lastRenderAt)
      ? THREE.MathUtils.clamp((nowMs - state.lastRenderAt) / 1000, 0, 0.05)
      : 0;
    const responseAlpha = state.renderPoseInitialized
      ? 1 - Math.exp(-RENDER_RESPONSE_PER_SECOND * elapsedSeconds)
      : 1;
    state.lastRenderAt = nowMs;
    renderFilteredPose(state, responseAlpha);
    // The rendered hand is retargeted to the XR skeleton and smoothed, so its
    // fingertip does not always project to the raw MediaPipe aim point.  Use
    // the visible fingertip for hover as well as pinch: users can now place
    // the hand model directly over an apparatus instead of aiming at an
    // invisible, offset cursor.
    updateRayFromVisualCursor(state);
    if (!state.pinching) updateHoverTarget(state, state.liveTarget, nowMs);
    if (Number.isFinite(state.pendingPinchRatio)) {
      updateGesture(state, state.pendingPinchRatio, state.pendingRawPinchRatio, nowMs);
      state.pendingPinchRatio = null;
      state.pendingRawPinchRatio = null;
    }
    if (state.pinching) {
      updateRayFromVisualCursor(state);
      const { dx, dy } = consumeDragDelta(state);
      onPinchMove?.({
        hand: state.label,
        raycaster: state.raycaster,
        target: state.lockedTarget,
        hoverTarget: state.liveTarget,
        ndc: state.cursorNdc,
        dx,
        dy,
      });
    }
    applyRayState(state);
  }

  function applyRayState(state) {
    state.visual.tipMaterial.color.setHex(
      state.pinching ? PINCH_CURSOR_COLOR : state.visual.color,
    );
  }

  function releaseState(state, { forceMachine = false } = {}) {
    if (forceMachine) state.pinch.forceEnd();
    const wasPinching = state.pinching;
    const lockedTarget = state.lockedTarget;
    state.pinching = false;
    state.suppressed = false;
    state.lockedTarget = null;
    state.dragResidual.set(0, 0);
    arbiter.release(state.label);
    // Keep status primary hand pointing at any remaining pinch.
    const remaining = states.find((other) => other.pinching && other.label !== state.label);
    if (remaining) arbiter.claim(remaining.label, remaining.lockedTarget);
    if (wasPinching) {
      onPinchEnd?.({
        hand: state.label,
        target: lockedTarget,
        hoverTarget: state.liveTarget,
        raycaster: state.raycaster,
        ndc: state.cursorNdc,
        cancelled: forceMachine,
      });
    }
    applyRayState(state);
    if (wasPinching && active) updateRunningStatus(performance.now(), true);
  }

  function consumeDragDelta(state) {
    const { width: cssW, height: cssH } = viewportCssSize();
    const rawDx = (state.cursorNdc.x - state.lastNdc.x) * cssW * 0.5;
    const rawDy = (state.cursorNdc.y - state.lastNdc.y) * cssH * -0.5;
    state.lastNdc.copy(state.cursorNdc);
    state.dragResidual.x += rawDx;
    state.dragResidual.y += rawDy;
    if (Math.hypot(state.dragResidual.x, state.dragResidual.y) < DRAG_DEAD_ZONE_PX) {
      return { dx: 0, dy: 0 };
    }
    const dx = THREE.MathUtils.clamp(state.dragResidual.x, -MAX_DRAG_DELTA_PX, MAX_DRAG_DELTA_PX);
    const dy = THREE.MathUtils.clamp(state.dragResidual.y, -MAX_DRAG_DELTA_PX, MAX_DRAG_DELTA_PX);
    state.dragResidual.set(0, 0);
    return { dx, dy };
  }

  function updateGesture(state, filteredRatio, rawRatio, nowMs) {
    const event = state.pinch.update(filteredRatio, rawRatio, nowMs);

    if (event === 'start') {
      // Both hands may pinch at once (dual-hand dolly). Arbiter tracks primary for status.
      // Lock the live cursor result at the exact pinch frame. hoverTarget is
      // intentionally sticky for visual stability and may refer to an object
      // the cursor has already left.
      updateRayFromVisualCursor(state);
      const pinchTarget = state.liveTarget;
      arbiter.claim(state.label, pinchTarget);
      state.pinching = true;
      state.suppressed = false;
      state.lockedTarget = pinchTarget;
      state.lastNdc.copy(state.cursorNdc);
      state.dragResidual.set(0, 0);
      onPinchStart?.({
        hand: state.label,
        raycaster: state.raycaster,
        target: state.lockedTarget,
        hoverTarget: state.liveTarget,
        ndc: state.cursorNdc,
      });
      updateRunningStatus(performance.now(), true);
    } else if (event === 'end') {
      releaseState(state);
    }
    applyRayState(state);
  }

  function recordFrameOutcome(wasDropped, nowMs = performance.now()) {
    recentFrameOutcomes.push({ timestamp: nowMs, dropped: wasDropped });
    if (wasDropped) droppedFrames += 1;
    while (recentFrameOutcomes.length && recentFrameOutcomes[0].timestamp < nowMs - 1000) {
      recentFrameOutcomes.shift();
    }
    const recentDrops = recentFrameOutcomes.reduce(
      (count, outcome) => count + Number(outcome.dropped),
      0,
    );
    dropRate = recentFrameOutcomes.length ? recentDrops / recentFrameOutcomes.length : 0;
  }

  function updateMetrics(inferenceSampleMs, pipelineSampleMs, nowMs) {
    if (Number.isFinite(inferenceSampleMs)) {
      inferenceSamples.push(inferenceSampleMs);
      if (inferenceSamples.length > 30) inferenceSamples.shift();
      inferenceMs = median(inferenceSamples);
    }
    if (Number.isFinite(pipelineSampleMs)) {
      pipelineSamples.push(Math.max(0, pipelineSampleMs));
      if (pipelineSamples.length > 30) pipelineSamples.shift();
      pipelineMs = median(pipelineSamples);
    }
    resultTimes.push(nowMs);
    while (resultTimes.length && resultTimes[0] < nowMs - 1000) resultTimes.shift();
    trackingFps = resultTimes.length;

    if (!degraded) {
      const shouldSlowDown = inferenceMs > 40 || pipelineMs > 80 || dropRate > 0.25;
      const canSpeedUp = inferenceMs < 28 && pipelineMs < 50 && dropRate < 0.1;
      if (shouldSlowDown) {
        adaptiveInterval = SLOW_INFERENCE_INTERVAL;
        fastInferenceSince = 0;
      } else if (adaptiveInterval === SLOW_INFERENCE_INTERVAL && canSpeedUp) {
        if (!fastInferenceSince) fastInferenceSince = nowMs;
        if (nowMs - fastInferenceSince >= 3000) {
          adaptiveInterval = NORMAL_INFERENCE_INTERVAL;
          fastInferenceSince = 0;
        }
      } else if (!canSpeedUp) {
        fastInferenceSince = 0;
      }
    }
  }

  function updateRunningStatus(nowMs, force = false) {
    if (!force && nowMs - lastMetricStatusAt < 1000) return;
    lastMetricStatusAt = nowMs;
    const performanceText = trackingFps ? ` · ${trackingFps} FPS` : '';
    const latencyText = pipelineMs ? ` · ${Math.round(pipelineMs)} ms` : '';
    const degradedText = degraded ? ' · 兼容模式' : ` · ${workerDelegate}`;
    const recoveryText = workerRestarts ? ` · 重启 ${workerRestarts}` : '';
    const droppedText = droppedFrames ? ` · 丢帧 ${droppedFrames}` : '';
    const pinchingCount = states.filter((state) => state.pinching).length;
    let activeHandText = '';
    if (pinchingCount >= 2) activeHandText = ' · 双手推进';
    else if (arbiter.activeHand) {
      activeHandText = ` · ${arbiter.activeHand === 'Left' ? '左手' : '右手'}操作`;
    }
    const detail = detectedHands
      ? `已识别 ${detectedHands} 只手${performanceText}${latencyText}${activeHandText}${degradedText}${recoveryText}${droppedText}`
      : `请将双手放入摄像头画面${degradedText}`;
    notify('running', detail);
  }

  function processHands(hands, sampleTimestamp, receivedAt, inferenceSampleMs) {
    updateMetrics(inferenceSampleMs, receivedAt - sampleTimestamp, receivedAt);
    const seen = new Set();
    const allDetections = hands
      .filter((hand) => hand?.landmarks?.length === 63)
      .map((hand) => ({
        hand,
        label: hand.label === 'Left' || hand.label === 'Right' ? hand.label : null,
        score: Number(hand.score) || 0,
        wrist: { x: hand.landmarks[0], y: hand.landmarks[1] },
      }));
    const primarySelection = selectPrimaryHandDetections(allDetections, states, {
      nowMs: receivedAt,
      lastPrimarySeenAt,
      lockTimeoutMs: PRIMARY_HAND_LOCK_TIMEOUT_MS,
      continuityMs: PRIMARY_HAND_CONTINUITY_MS,
      maxContinuityDistance: PRIMARY_HAND_REACQUIRE_DISTANCE,
    });
    const detections = primarySelection.detections;
    const assignment = assignHandTracks(states, detections, {
      activeHand: arbiter.activeHand,
      nowMs: receivedAt,
    });

    states.forEach((state, stateIndex) => {
      const detectionIndex = assignment[stateIndex];
      if (detectionIndex < 0) return;
      const detection = detections[detectionIndex];
      const { hand } = detection;
      if (unpackLandmarks(hand.landmarks, state.sampleLandmarks) !== 21) return;
      const worldCount = unpackLandmarks(hand.worldLandmarks, state.sampleWorldLandmarks);
      seen.add(state.label);
      state.visible = true;
      state.trackingVisible = true;
      state.lastSeenAt = receivedAt;
      state.handednessScore = detection.score;
      if (!state.lastWrist) state.lastWrist = new THREE.Vector2();
      state.lastWrist.set(detection.wrist.x, detection.wrist.y);
      updatePoseSample(
        state,
        state.sampleLandmarks,
        state.sampleWorldLandmarks,
        worldCount === 21,
        sampleTimestamp,
      );
      const rawPinchRatio = estimatePinchRatio(state.sampleLandmarks);
      state.rawPinchRatio = rawPinchRatio;
      state.filteredPinchRatio = state.pinchMedian.filter(rawPinchRatio);
      estimatePalmCenter(state.sampleLandmarks, state.palmSample);
      cameraPointToNdc(state.palmSample, state.palmSample);
      state.palmNdc.set(state.palmSample.x, state.palmSample.y);
      state.openPalm = isOpenPalm(state.sampleLandmarks, { minPinchRatio: 0.52 });
      state.pendingPinchRatio = state.filteredPinchRatio;
      state.pendingRawPinchRatio = rawPinchRatio;
    });

    if (seen.size > 0) lastPrimarySeenAt = receivedAt;

    // Do not mark a hand lost on the first missing inference result. Webcam
    // motion blur and worker-frame drops are common enough that doing so made
    // the UI flicker into “tracking lost” and cancelled active pinches.
    // updateOcclusion() changes trackingVisible only after the hold window.
    if (detectedHands !== seen.size) {
      detectedHands = seen.size;
      updateRunningStatus(receivedAt, true);
    } else {
      updateRunningStatus(receivedAt);
    }
  }

  function updateOcclusion(nowMs) {
    states.forEach((state) => {
      if (!state.visible) return;
      const elapsed = nowMs - state.lastSeenAt;
      if (elapsed <= OCCLUSION_HOLD_MS) return;
      state.trackingVisible = false;
      if (elapsed > OCCLUSION_HOLD_MS && (state.pinching || state.suppressed)) {
        releaseState(state, { forceMachine: true });
      }
      const opacity = occlusionOpacity(elapsed);
      setVisualOpacity(state.visual, opacity);
      if (opacity <= 0) {
        state.visible = false;
        state.poseInitialized = false;
        state.renderPoseInitialized = false;
        state.lastRenderAt = -Infinity;
        state.pendingPinchRatio = null;
        state.pendingRawPinchRatio = null;
        state.pinchMedian.reset();
        state.rawPinchRatio = Infinity;
        state.filteredPinchRatio = Infinity;
        state.openPalm = false;
        state.palmNdc.set(0, 0);
        state.hoverTarget = null;
        state.hoverCandidate = null;
        state.liveTarget = null;
        state.pinch.reset();
      }
    });
  }

  function handleWorkerMessage({ data }) {
    if (data?.type === 'result') {
      if (data.frameId !== inflightFrameId) return;
      if (workerFrameTimer) window.clearTimeout(workerFrameTimer);
      workerFrameTimer = 0;
      workerBusy = false;
      inflightFrameId = 0;
      recoveryPolicy.recordSuccess();
      const receivedAt = performance.now();
      const sampleTimestamp = Number.isFinite(data.timestamp) ? data.timestamp : receivedAt;
      processHands(data.hands || [], sampleTimestamp, receivedAt, data.inferenceMs);
      return;
    }
    if (data?.type === 'error' && data.stage === 'frame') {
      if (data.frameId !== inflightFrameId) return;
      if (workerFrameTimer) window.clearTimeout(workerFrameTimer);
      workerFrameTimer = 0;
      workerBusy = false;
      inflightFrameId = 0;
      recordFrameOutcome(true);
      if (recoveryPolicy.recordFrameError() === 'restart') {
        recoverWorker(data.message || '后台追踪连续帧错误');
      }
    }
  }

  async function recoverWorker(reason = '') {
    if (recoveringWorker || degraded || fallbackStarting || !active) return;
    recoveringWorker = true;
    cleanupWorker();
    workerRestarts += 1;
    notify('loading', '后台追踪中断，正在自动恢复…');
    try {
      await initializeWorker();
      recoveryPolicy.reset();
      adaptiveInterval = SLOW_INFERENCE_INTERVAL;
      fastInferenceSince = 0;
      updateRunningStatus(performance.now(), true);
    } catch (error) {
      await switchToFallback(reason || error?.message || '后台追踪恢复失败');
    } finally {
      recoveringWorker = false;
    }
  }

  function initializeWorker() {
    return new Promise((resolve, reject) => {
      const candidate = new Worker(new URL('./handTracking.worker.js', import.meta.url), { type: 'module' });
      worker = candidate;
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Hand tracking worker timed out'));
      }, 15000);

      candidate.onmessage = (event) => {
        if (!settled && event.data?.type === 'ready') {
          settled = true;
          window.clearTimeout(timeout);
          workerDelegate = event.data.delegate === 'GPU' ? 'GPU' : 'CPU';
          resolve(workerDelegate);
          return;
        }
        if (!settled && event.data?.type === 'error') {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(event.data.message || 'Hand tracking worker failed'));
          return;
        }
        handleWorkerMessage(event);
      };
      candidate.onerror = (event) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(event.message || 'Hand tracking worker failed'));
        } else {
          recoverWorker(event.message);
        }
      };
      candidate.postMessage({
        type: 'init',
        wasmLoaderPath: MEDIAPIPE_WASM_LOADER,
        wasmBinaryPath: MEDIAPIPE_WASM_BINARY,
        modelPath: '/assets/mediapipe/hand_landmarker.task',
        // Interaction has exactly two persistent hand tracks. Asking the model
        // for four candidates adds avoidable inference cost and latency.
        numHands: 2,
      });
    });
  }

  function cleanupWorker() {
    if (workerFrameTimer) window.clearTimeout(workerFrameTimer);
    workerFrameTimer = 0;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    workerBusy = false;
    inflightFrameId = 0;
    capturePending = false;
  }

  function errorMessage(error, fallback = '未知错误') {
    if (typeof error === 'string' && error.trim()) return error.trim();
    return error?.message || fallback;
  }

  async function ensureFallbackLandmarker() {
    if (fallbackLandmarker) return workerDelegate;
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks('/assets/mediapipe/wasm');
    let gpuError = null;
    for (const delegate of ['GPU', 'CPU']) {
      try {
        fallbackLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/assets/mediapipe/hand_landmarker.task',
            delegate,
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        workerDelegate = delegate;
        mainThreadInference = true;
        if (delegate === 'CPU') {
          degraded = true;
          adaptiveInterval = FALLBACK_INFERENCE_INTERVAL;
          console.warn(
            '[Hand tracking] GPU unavailable; using CPU compatibility mode',
            errorMessage(gpuError),
          );
        }
        return delegate;
      } catch (error) {
        if (delegate === 'GPU') {
          gpuError = error;
          continue;
        }
        throw new Error(
          `手部模型初始化失败：GPU ${errorMessage(gpuError)}；CPU ${errorMessage(error)}`,
        );
      }
    }
    throw new Error('手部模型初始化失败');
  }

  async function switchToFallback(reason = '') {
    if (degraded || fallbackStarting || !active) return;
    fallbackStarting = true;
    cleanupWorker();
    degraded = true;
    adaptiveInterval = FALLBACK_INFERENCE_INTERVAL;
    notify('loading', reason ? '后台追踪不可用，正在启用兼容模式…' : '正在启用兼容模式…');
    try {
      await ensureFallbackLandmarker();
      updateRunningStatus(performance.now(), true);
    } catch (error) {
      notify('error', errorMessage(error, '兼容模式启动失败'));
      stop(false);
    } finally {
      fallbackStarting = false;
    }
  }

  async function ensureInference() {
    degraded = false;
    recoveringWorker = false;
    adaptiveInterval = NORMAL_INFERENCE_INTERVAL;
    recoveryPolicy.reset();
    // GPU delegation depends on a WebGL context. Several Chromium/macOS
    // combinations can initialize that context in a worker but lose it on the
    // first detectForVideo call, causing an endless worker-restart loop.
    // HoloMath runs its GPU landmarker on the main thread; use the same stable
    // path here while keeping the 3D scene rendering and input state separate.
    cleanupWorker();
    await ensureFallbackLandmarker();
  }

  function cleanupInference() {
    cleanupWorker();
    fallbackLandmarker?.close?.();
    fallbackLandmarker = null;
    fallbackStarting = false;
    mainThreadInference = false;
  }

  function resetTrackingState() {
    states.forEach((state) => {
      releaseState(state, { forceMachine: true });
      state.visible = false;
      state.trackingVisible = false;
      state.poseInitialized = false;
      state.renderPoseInitialized = false;
      state.lastSeenAt = -Infinity;
      state.lastWrist = null;
      state.handednessScore = 0;
      state.lastRenderAt = -Infinity;
      state.pendingPinchRatio = null;
      state.pendingRawPinchRatio = null;
      state.pinchMedian.reset();
      state.rawPinchRatio = Infinity;
      state.filteredPinchRatio = Infinity;
      state.openPalm = false;
      state.palmNdc.set(0, 0);
      state.hoverTarget = null;
      state.liveTarget = null;
      state.hoverCandidate = null;
      state.hoverCandidateSince = -Infinity;
      state.lastHoverAt = -Infinity;
      state.visual.group.visible = false;
    });
    arbiter.reset();
    lastPrimarySeenAt = -Infinity;
    detectedHands = 0;
    trackingFps = 0;
    inferenceMs = 0;
    pipelineMs = 0;
    droppedFrames = 0;
    workerRestarts = 0;
    workerDelegate = 'CPU';
    dropRate = 0;
    inferenceSamples.length = 0;
    pipelineSamples.length = 0;
    resultTimes.length = 0;
    recentFrameOutcomes.length = 0;
    recoveryPolicy.reset();
  }

  function stopTracks() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
  }

  async function start() {
    if (active || starting) return active;
    starting = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前环境不支持摄像头访问');
      }
      notify('permission', '等待摄像头授权…');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, max: 60 },
        },
      });
      video.srcObject = stream;
      await video.play();
      notify('loading', '正在加载本地手部模型…');
      await Promise.all([ensureHandModels(), ensureInference()]);
      active = true;
      lastVideoTime = -1;
      lastInferenceAt = 0;
      lastMetricStatusAt = 0;
      updateRunningStatus(performance.now(), true);
      return true;
    } catch (error) {
      active = false;
      stopTracks();
      cleanupInference();
      resetTrackingState();
      const detail = error?.name === 'NotAllowedError'
        ? '摄像头权限被拒绝，请在系统设置中允许后重试'
        : errorMessage(error, 'AR 模式启动失败');
      notify('error', detail);
      return false;
    } finally {
      starting = false;
    }
  }

  function stop(emitStatus = true) {
    active = false;
    stopTracks();
    cleanupInference();
    resetTrackingState();
    if (emitStatus) notify('off', 'AR 模式已关闭');
  }

  async function toggle() {
    if (active || starting) {
      stop();
      return false;
    }
    return start();
  }

  async function submitWorkerFrame(timestamp) {
    if (capturePending || workerBusy || recoveringWorker || !worker || !active) {
      if (active && worker) recordFrameOutcome(true, timestamp);
      return;
    }
    capturePending = true;
    try {
      const bitmap = await createImageBitmap(video);
      if (!active || !worker) {
        bitmap.close();
        return;
      }
      const frameId = nextFrameId;
      nextFrameId += 1;
      workerBusy = true;
      inflightFrameId = frameId;
      recordFrameOutcome(false, timestamp);
      worker.postMessage({ type: 'frame', frameId, bitmap, timestamp }, [bitmap]);
      workerFrameTimer = window.setTimeout(() => {
        if (!workerBusy || inflightFrameId !== frameId) return;
        workerBusy = false;
        inflightFrameId = 0;
        workerFrameTimer = 0;
        recordFrameOutcome(true);
        if (recoveryPolicy.recordTimeout() === 'restart') {
          recoverWorker('后台追踪单帧超时');
        }
      }, WORKER_FRAME_TIMEOUT_MS);
    } catch (error) {
      switchToFallback(error?.message || '摄像头帧传输失败');
    } finally {
      capturePending = false;
    }
  }

  function runFallbackFrame(timestamp) {
    if (!fallbackLandmarker || fallbackStarting) return;
    const startedAt = performance.now();
    try {
      const result = fallbackLandmarker.detectForVideo(video, timestamp);
      const receivedAt = performance.now();
      processHands(
        serializeMainThreadResult(result),
        timestamp,
        receivedAt,
        receivedAt - startedAt,
      );
    } catch (error) {
      console.warn('[MediaPipe] fallback hand frame failed', error);
    }
  }

  function update(nowMs = performance.now()) {
    states.forEach((state) => updateHologram(state.visual, nowMs));
    states.forEach((state) => renderTrackedState(state, nowMs));
    updateOcclusion(nowMs);
    if (!active || video.readyState < 2 || fallbackStarting || recoveringWorker) return;
    const interval = degraded ? FALLBACK_INFERENCE_INTERVAL : adaptiveInterval;
    if (video.currentTime === lastVideoTime || nowMs - lastInferenceAt < interval) return;
    lastVideoTime = video.currentTime;
    lastInferenceAt = nowMs;
    if (mainThreadInference || degraded) runFallbackFrame(nowMs);
    else submitWorkerFrame(nowMs);
  }

  function getPrimaryInteraction() {
    const pinchingHands = states.filter((state) => state.pinching && state.trackingVisible);
    // Dual-hand pinch is reserved for camera dolly; never treat it as equipment grab.
    if (pinchingHands.length >= 2) {
      return {
        holding: false,
        target: null,
        hoverTarget: null,
        hand: null,
        dual: true,
        raycaster: null,
      };
    }
    if (pinchingHands.length === 1) {
      const owner = pinchingHands[0];
      return {
        holding: true,
        // Pinch acts like a mouse button: locked target at press, live hover while held.
        target: owner.lockedTarget || owner.liveTarget || owner.hoverTarget,
        hoverTarget: owner.liveTarget || owner.hoverTarget,
        hand: owner.label,
        dual: false,
        raycaster: owner.raycaster,
      };
    }
    const hovering = states.find((state) => state.visible && state.trackingVisible && state.hoverTarget);
    return {
      holding: false,
      target: hovering?.hoverTarget || null,
      hoverTarget: hovering?.liveTarget || null,
      hand: hovering?.label || null,
      dual: false,
      raycaster: hovering?.raycaster || null,
    };
  }

  function getHandState(label) {
    return states.find((state) => state.label === label) || null;
  }

  function destroy() {
    stop(false);
    states.forEach((state) => disposeVisual(state.visual));
  }

  return {
    start,
    stop,
    toggle,
    update,
    destroy,
    getPrimaryInteraction,
    getHandState,
    isActive: () => active,
    isStarting: () => starting,
    isPinching: () => states.some((state) => state.pinching),
  };
}
