import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { diffractionHalfSpan, diffractionIntensity } from '../../experiments/optics.js';
import {
  createGeometricOpticsRig,
  GEO_HOST_SCALE,
} from '../../guangxue/geometricRig.js';
import {
  isGeometricOpticsExp,
  resolveExperimentConfig,
  getGeometricExperiment,
} from '../../guangxue/catalog.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createInstancedBatch } from '../shared/instancedBatch.js';
import { labFrameScheduler } from '../../frameBudget.js';
import { createEquipmentRuntime, getLeafPickSet, estimateObjectBytes } from '../../runtime/experimentRuntime.js';

/**
 * Keep station menus cheap. The diffraction bench, geometric optics rig and
 * PMREM environment are created only after the first optics experiment mode
 * is requested.
 */
export function createStationEquipment(ctx) {
  const { THREE } = ctx;
  const root = new THREE.Group();
  root.name = 'optics-station';
  let full = null;
  const ensureFull = () => {
    if (full) return full;
    full = createFullStationEquipment(ctx);
    root.add(full.root);
    return full;
  };
  const call = (method, ...args) => full?.equipment?.[method]?.(...args);
  const modeFor = (id) => id === 'multi_slit_diffraction' ? 'diffraction' : 'geometric';
  const runtimeRootFor = (id) => {
    if (!full) return null;
    return id === 'multi_slit_diffraction' ? full.refs?.optics : full.refs?.geoRig;
  };
  const createRuntime = (id) => createEquipmentRuntime({
    id,
    root: runtimeRootFor(id) || ensureFull().root,
    prepare: async (_prepareContext, signal) => {
      ensureFull();
      if (signal?.aborted) throw abortError();
    },
    prepareRoot: () => runtimeRootFor(id) || full?.root,
    activate: () => full?.equipment?.setMode?.(modeFor(id), { gpuReady: full?.equipment?.geoGpuReady }),
    suspend: () => {
      if (full?.equipment?.activeMode === modeFor(id)) full.equipment.setMode?.('off');
    },
    unmount: () => {},
    getPickSet: () => getLeafPickSet(runtimeRootFor(id) || full?.root),
    estimateBytes: () => estimateObjectBytes(runtimeRootFor(id) || full?.root),
    dispose: () => { if (full?.equipment?.activeMode === modeFor(id)) full.equipment.setMode?.('off'); },
  });
  const equipment = {
    prepareExperiment: () => ensureFull(),
    createRuntime,
    setMode: (mode, ...args) => mode ? ensureFull().equipment.setMode(mode, ...args) : call('setMode', null, ...args),
    hideAll: (...args) => call('hideAll', ...args),
    showcase: (...args) => call('showcase', ...args),
    shutdown: (...args) => call('shutdown', ...args),
    suspend: (...args) => call('suspend', ...args),
    resume: (...args) => call('resume', ...args),
    compileGeometricGpu: (...args) => call('compileGeometricGpu', ...args),
    ensureGeometricReady: (...args) => full ? call('ensureGeometricReady', ...args) : Promise.resolve(false),
    revealGeometricIsland: (...args) => call('revealGeometricIsland', ...args),
    updateOptics: (...args) => ensureFull().equipment.updateOptics(...args),
    updateGeometric: (...args) => ensureFull().equipment.updateGeometric(...args),
    flushDeferredGeometry: (...args) => call('flushDeferredGeometry', ...args),
    stepDeferredGeometry: (...args) => call('stepDeferredGeometry', ...args),
    flushDeferredDiffraction: (...args) => call('flushDeferredDiffraction', ...args),
    stepDiffractionPaint: (...args) => call('stepDiffractionPaint', ...args),
    cancelDeferred: (...args) => call('cancelDeferred', ...args),
    snapshotGeometric: (...args) => call('snapshotGeometric', ...args),
    setPartState: (...args) => call('setPartState', ...args),
    clearIdentifyVisuals: (...args) => call('clearIdentifyVisuals', ...args),
    getCamera: () => ctx.camera,
    getRoot: () => full?.root || root,
    getRuntimeRoot: (mode) => (mode === 'multi_slit_diffraction' || mode === 'diffraction' ? full?.refs?.optics : full?.refs?.geoRig) || full?.root || root,
    root,
    get opticsGroup() { return full?.refs?.optics || null; },
    get geoRig() { return full?.equipment?.geoRig || full?.refs?.geoRig || null; },
    mouseDrag: { holdLMB: false, movementX: 0 },
    get activeMode() { return full?.equipment?.activeMode || 'off'; },
    get geoGpuReady() { return !!full?.equipment?.geoGpuReady; },
    get geoWarming() { return !!full?.equipment?.geoWarming; },
  };
  const animators = [(_t, _dt) => {
    full?.animators?.forEach((animate) => animate(_t, _dt));
  }];
  // Intent/open path owns GPU prepare; no boot prewarm map.
  return { root, equipment, animators, refs: { optics: null, geoRig: null } };
}

function abortError() {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

function createFullStationEquipment(ctx) {
  const { THREE, primitives, shared, renderer } = ctx;
  const { rbox, cyl } = primitives;

  function makeOpticsBench() {
    const g = new THREE.Group();
    const lab = {
      brass: new THREE.MeshStandardMaterial({
        color: 0xc9a227, metalness: 0.92, roughness: 0.32, emissive: 0x3d3008, emissiveIntensity: 0.08,
      }),
      steel: new THREE.MeshStandardMaterial({
        color: 0x8b939e, metalness: 0.88, roughness: 0.3, emissive: 0x101418, emissiveIntensity: 0.05,
      }),
      matteBlack: new THREE.MeshStandardMaterial({
        color: 0x1a1d22, metalness: 0.2, roughness: 0.75, emissive: 0x050505, emissiveIntensity: 0.04,
      }),
      paper: new THREE.MeshStandardMaterial({
        color: 0xf3efe6, metalness: 0.02, roughness: 0.88, emissive: 0x1a1810, emissiveIntensity: 0.04,
      }),
    };

    function makeSelectOutline(sx, sy, sz) {
      const box = new THREE.BoxGeometry(sx, sy, sz);
      const edges = new THREE.EdgesGeometry(box);
      const geometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
      box.dispose();
      edges.dispose();
      const lineMat = new LineMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0,
        linewidth: 4,
        worldUnits: false,
        resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
        depthTest: true,
        toneMapped: false,
      });
      const outline = new LineSegments2(geometry, lineMat);
      outline.computeLineDistances();
      outline.visible = false;
      outline.userData.isOutline = true;
      return outline;
    }

    function addRecognitionTarget(host, role, size, outlinePos = [0, 0, 0]) {
      const hit = new THREE.Mesh(
        new THREE.BoxGeometry(...size),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hit.position.set(...outlinePos);
      hit.userData.interactive = true;
      hit.userData.role = role;
      host.add(hit);
      const outline = makeSelectOutline(...size);
      outline.position.set(...outlinePos);
      host.add(outline);
      return { outline, hit };
    }

    // ── Shared optical rail ──
    const rail = rbox(2.2, 0.045, 0.18, lab.matteBlack, 0.01);
    rail.position.y = 0.05;
    g.add(rail);
    const railTop = rbox(2.2, 0.012, 0.05, lab.steel, 0.003);
    railTop.position.y = 0.078;
    g.add(railTop);
    for (const z of [-0.095, 0.095]) {
      const side = rbox(2.2, 0.028, 0.018, lab.steel, 0.004);
      side.position.set(0, 0.095, z);
      g.add(side);
    }
    for (const x of [-1.1, 1.1]) {
      const endCap = rbox(0.024, 0.055, 0.21, lab.matteBlack, 0.005);
      endCap.position.set(x, 0.055, 0);
      g.add(endCap);
    }
    const majorTicks = createInstancedBatch({
      geometry: new THREE.BoxGeometry(0.006, 0.01, 0.07),
      material: lab.brass,
      capacity: 5,
      dynamic: false,
      castShadow: true,
      receiveShadow: true,
      name: 'optics-rail-major-ticks',
    });
    const minorTicks = createInstancedBatch({
      geometry: new THREE.BoxGeometry(0.006, 0.01, 0.04),
      material: lab.brass,
      capacity: 17,
      dynamic: false,
      castShadow: true,
      receiveShadow: true,
      name: 'optics-rail-minor-ticks',
    });
    g.add(majorTicks.mesh, minorTicks.mesh);
    let majorCount = 0;
    let minorCount = 0;
    for (let i = 0; i <= 21; i++) {
      const batch = i % 5 === 0 ? majorTicks : minorTicks;
      const index = i % 5 === 0 ? majorCount++ : minorCount++;
      batch.setTransform(index, { position: [-1.05 + i * 0.1, 0.09, 0] });
    }
    majorTicks.setCount(majorCount);
    minorTicks.setCount(minorCount);
    majorTicks.commit();
    minorTicks.commit();
    const railHit = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.12, 0.22),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    railHit.position.y = 0.08;
    railHit.userData.interactive = true;
    railHit.userData.role = 'opt_rail';
    g.add(railHit);

    // ── Fraunhofer single/multi-slit mode (ported from danfen source) ──
    const diffractionGroup = new THREE.Group();
    diffractionGroup.name = 'diffractionSetup';
    diffractionGroup.visible = false;

    function spectralColor(nm) {
      let r = 0; let gg = 0; let b = 0;
      if (nm < 440) { r = -(nm - 440) / 60; b = 1; }
      else if (nm < 490) { gg = (nm - 440) / 50; b = 1; }
      else if (nm < 510) { gg = 1; b = -(nm - 510) / 20; }
      else if (nm < 580) { r = (nm - 510) / 70; gg = 1; }
      else if (nm < 645) { r = 1; gg = -(nm - 645) / 65; }
      else r = 1;
      let f = 1;
      if (nm < 420) f = 0.3 + 0.7 * (nm - 380) / 40;
      if (nm > 700) f = 0.3 + 0.7 * (780 - nm) / 80;
      return new THREE.Color(
        THREE.MathUtils.clamp(r * f, 0, 1),
        THREE.MathUtils.clamp(gg * f, 0, 1),
        THREE.MathUtils.clamp(b * f, 0, 1),
      );
    }

    function makeDiffPost(x) {
      const post = new THREE.Group();
      post.position.x = x;
      const base = rbox(0.13, 0.04, 0.15, lab.matteBlack, 0.008);
      base.position.y = 0.12;
      post.add(base);
      const rod = cyl(0.012, 0.015, 0.3, lab.steel, 14);
      rod.position.y = 0.25;
      post.add(rod);
      diffractionGroup.add(post);
      return post;
    }

    const diffSource = makeDiffPost(-0.9);
    const diffLaserBody = cyl(0.04, 0.045, 0.23, lab.matteBlack, 24);
    diffLaserBody.rotation.z = Math.PI / 2;
    diffLaserBody.position.set(0, 0.39, 0);
    diffSource.add(diffLaserBody);
    const diffLaserNose = cyl(0.018, 0.035, 0.06, lab.steel, 18);
    diffLaserNose.rotation.z = Math.PI / 2;
    diffLaserNose.position.set(0.145, 0.39, 0);
    diffSource.add(diffLaserNose);
    const diffEmitterMat = new THREE.MeshBasicMaterial({ color: 0x44ff88 });
    const diffEmitter = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), diffEmitterMat);
    diffEmitter.position.set(0.18, 0.39, 0);
    diffSource.add(diffEmitter);
    const diffHalo = new THREE.Mesh(
      new THREE.CircleGeometry(0.042, 32),
      new THREE.MeshBasicMaterial({
        color: 0x44ff88,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    diffHalo.rotation.y = Math.PI / 2;
    diffHalo.position.set(0.181, 0.39, 0);
    diffSource.add(diffHalo);
    diffSource.userData.interactive = true;
    diffSource.userData.role = 'diff_source';
    const sourceHit = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.34, 0.24),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    sourceHit.position.y = 0.32;
    sourceHit.userData.interactive = true;
    sourceHit.userData.role = 'diff_source';
    diffSource.add(sourceHit);

    const diffSlitMount = makeDiffPost(-0.34);
    const diffSlitFrame = rbox(0.035, 0.34, 0.36, lab.matteBlack, 0.008);
    diffSlitFrame.position.y = 0.39;
    diffSlitMount.add(diffSlitFrame);
    const diffSlitBars = new THREE.Group();
    diffSlitBars.position.y = 0.39;
    diffSlitMount.add(diffSlitBars);
    const diffSlitBarBatch = createInstancedBatch({
      geometry: new THREE.BoxGeometry(0.04, 0.26, 1),
      material: lab.matteBlack.clone(),
      capacity: 32,
      dynamic: true,
      name: 'diffraction-slit-bars',
    });
    diffSlitBars.add(diffSlitBarBatch.mesh);
    const diffSlitGlows = new THREE.Group();
    diffSlitGlows.position.set(-0.019, 0.39, 0);
    diffSlitMount.add(diffSlitGlows);
    const diffGlowMat = new THREE.MeshBasicMaterial({
      color: 0x44ff88,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const diffGlowBatch = createInstancedBatch({
      geometry: new THREE.PlaneGeometry(1, 0.24),
      material: diffGlowMat,
      capacity: 32,
      dynamic: true,
      castShadow: false,
      receiveShadow: false,
      name: 'diffraction-slit-glows',
    });
    diffSlitGlows.add(diffGlowBatch.mesh);
    diffSlitMount.userData.interactive = true;
    diffSlitMount.userData.role = 'diff_slit';
    const slitHit = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.4, 0.42),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    slitHit.position.y = 0.36;
    slitHit.userData.interactive = true;
    slitHit.userData.role = 'diff_slit';
    diffSlitMount.add(slitHit);

    const diffScreen = makeDiffPost(0.5);
    const diffScreenBack = rbox(0.035, 0.48, 0.62, lab.matteBlack, 0.008);
    diffScreenBack.position.y = 0.39;
    diffScreen.add(diffScreenBack);
    const diffScreenCanvas = document.createElement('canvas');
    diffScreenCanvas.width = 640;
    diffScreenCanvas.height = 240;
    const diffScreenCtx = diffScreenCanvas.getContext('2d');
    const diffScreenTex = new THREE.CanvasTexture(diffScreenCanvas);
    diffScreenTex.colorSpace = THREE.SRGBColorSpace;
    const diffScreenFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.42),
      new THREE.MeshBasicMaterial({ map: diffScreenTex, side: THREE.DoubleSide, toneMapped: false }),
    );
    diffScreenFace.rotation.y = -Math.PI / 2;
    diffScreenFace.position.set(-0.02, 0.39, 0);
    diffScreen.add(diffScreenFace);
    diffScreen.userData.interactive = true;
    diffScreen.userData.role = 'diff_screen';
    const screenHit = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.55, 0.7),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    screenHit.position.y = 0.35;
    screenHit.userData.interactive = true;
    screenHit.userData.role = 'diff_screen';
    diffScreen.add(screenHit);

    const diffBeamGroup = new THREE.Group();
    diffractionGroup.add(diffBeamGroup);
    const diffWaveGroup = new THREE.Group();
    diffWaveGroup.position.set(diffSlitMount.position.x, 0.392, 0);
    diffractionGroup.add(diffWaveGroup);
    const waveArcPositions = [];
    for (let j = 0; j <= 48; j++) {
      const angle = -0.95 + (1.9 * j) / 48;
      waveArcPositions.push(Math.cos(angle), 0, Math.sin(angle));
    }
    for (let i = 0; i < 5; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(waveArcPositions, 3));
      const wave = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: 0x44ff88,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      wave.frustumCulled = false;
      diffWaveGroup.add(wave);
    }
    const diffLaserLight = new THREE.PointLight(0x44ff88, 0.35, 1.2, 2);
    diffLaserLight.castShadow = false;
    diffLaserLight.position.set(-0.7, 0.42, 0);
    diffractionGroup.add(diffLaserLight);
    g.add(diffractionGroup);

    let diffSignature = '';
    let diffWavePhase = 0;
    /** Deferred diffraction paint so experiment switch does not stall the click frame. */
    let deferredDiffraction = null;
    function disposeChildren(group) {
      while (group.children.length) {
        const child = group.children.pop();
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material?.dispose();
      }
    }

    /**
     * Sample host SimBackend intensity curve (optics.diffractionFringe) at
     * screen x. Falls back to analytic diffractionIntensity when samples
     * are missing / mismatched.
     * @param {number} x
     * @param {object} job
     */
    function intensityForPaint(x, job) {
      const samples = job.simIntensity;
      const half = job.half;
      if (samples?.length > 1 && half > 0) {
        const u = (x / half + 1) * 0.5;
        const n = samples.length;
        const f = Math.max(0, Math.min(n - 1, u * (n - 1)));
        const i0 = f | 0;
        const i1 = Math.min(n - 1, i0 + 1);
        const t = f - i0;
        return samples[i0] * (1 - t) + samples[i1] * t;
      }
      return diffractionIntensity(x, job.d);
    }

    function updateDiffraction(d, opts = {}) {
      if (!d) return;
      // Include host intensity generation so deferred worker samples re-paint.
      const signature = [
        d.lightOn, d.lambdaNm, d.slitMm, d.pitchMm, d.N, d.distM,
        d.showBeam, d.showWave, d._simIntensityGen | 0,
      ].join('|');
      // Already painted (typical after intent prepare / re-entry) — free switch.
      if (!opts.force && signature === diffSignature) {
        deferredDiffraction = null;
        return;
      }
      if (opts.defer) {
        deferredDiffraction = { ...d };
        return;
      }
      deferredDiffraction = null;
      diffSignature = signature;
      const color = spectralColor(Number(d.lambdaNm || 550));
      const lit = !!d.lightOn;
      diffEmitterMat.color.copy(color);
      diffEmitter.visible = lit;
      diffHalo.material.color.copy(color);
      diffHalo.visible = lit;
      diffLaserLight.color.copy(color);
      diffLaserLight.visible = lit;
      diffWaveGroup.visible = lit && d.showWave !== false;
      diffWaveGroup.children.forEach((wave) => wave.material.color.copy(color));

      const nSlits = Math.max(1, Math.round(Number(d.N || 2)));
      const aV = THREE.MathUtils.clamp(Number(d.slitMm || 0.05) * 0.06, 0.002, 0.015);
      const pitchV = THREE.MathUtils.clamp(Number(d.pitchMm || 0.25) * 0.1, aV + 0.003, 0.04);
      const centers = Array.from({ length: nSlits }, (_, i) => nSlits === 1 ? 0 : (i - (nSlits - 1) / 2) * pitchV);
      const plateHalf = Math.max(0.16, ((nSlits - 1) * pitchV + aV) / 2 + 0.035);
      diffGlowMat.color.copy(color);
      diffGlowMat.opacity = lit ? 0.85 : 0;
      const segments = [[-plateHalf, centers[0] - aV / 2]];
      for (let i = 0; i < centers.length - 1; i++) segments.push([centers[i] + aV / 2, centers[i + 1] - aV / 2]);
      segments.push([centers[centers.length - 1] + aV / 2, plateHalf]);
      let barIndex = 0;
      for (const [z0, z1] of segments) {
        if (z1 - z0 < 0.001) continue;
        diffSlitBarBatch.setTransform(barIndex++, {
          position: [0, 0, (z0 + z1) / 2],
          scale: [1, 1, z1 - z0],
        });
      }
      diffSlitBarBatch.setCount(barIndex);
      diffSlitBarBatch.commit();
      centers.forEach((z, index) => {
        diffGlowBatch.setTransform(index, {
          position: [0, 0, z],
          rotation: [0, Math.PI / 2, 0],
          scale: [Math.max(0.0015, aV * 0.85), 1, 1],
        });
      });
      diffGlowBatch.setCount(centers.length);
      diffGlowBatch.commit();

      const slitX = diffSlitMount.position.x;
      const screenX = slitX + 0.34 + ((Number(d.distM || 1) - 0.4) / 1.6) * 0.9;
      diffScreen.position.x = screenX;
      disposeChildren(diffBeamGroup);
      if (lit && d.showBeam !== false) {
        const inLen = slitX - (-0.72);
        const inBeam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.005, 0.008, inLen, 12, 1, true),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending }),
        );
        inBeam.rotation.z = Math.PI / 2;
        inBeam.position.set(-0.72 + inLen / 2, 0.39, 0);
        diffBeamGroup.add(inBeam);
        const halfVisual = 0.28;
        const fanGeo = new THREE.BufferGeometry();
        fanGeo.setAttribute('position', new THREE.Float32BufferAttribute([
          slitX, 0.39, 0,
          screenX - 0.025, 0.39, -halfVisual,
          screenX - 0.025, 0.39, halfVisual,
        ], 3));
        fanGeo.setIndex([0, 1, 2]);
        diffBeamGroup.add(new THREE.Mesh(
          fanGeo,
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
        ));
      }

      // Geometry/beams done; fringe paint is progressive (coop) so switch does
      // not freeze the camera on a 640×H pixel loop.
      const W = diffScreenCanvas.width;
      const H = diffScreenCanvas.height;
      diffScreenCtx.fillStyle = '#030509';
      diffScreenCtx.fillRect(0, 0, W, H);
      diffScreenTex.needsUpdate = true;
      if (lit) {
        const hostHalf = Number(d._simHalfSpanM);
        const half = (Number.isFinite(hostHalf) && hostHalf > 0)
          ? hostHalf
          : diffractionHalfSpan(d);
        // Snapshot host intensity so progressive paint stays consistent if
        // the next sim frame replaces d._simIntensity mid-job.
        const simIntensity = d._simIntensity?.length
          ? (d._simIntensity instanceof Float32Array
            ? new Float32Array(d._simIntensity)
            : Float32Array.from(d._simIntensity))
          : null;
        if (!diffScreenImageData || diffScreenImageData.width !== W || diffScreenImageData.height !== H) {
          diffScreenImageData = diffScreenCtx.createImageData(W, H);
        }
        diffPaint = {
          col: 0,
          W,
          H,
          half,
          color: color.clone(),
          d: { ...d },
          simIntensity,
          image: diffScreenImageData,
        };
        if (opts.syncPaint !== false) {
          while (stepDiffractionPaint()) {
            /* complete paint immediately */
          }
        }
      } else {
        diffPaint = null;
      }
    }

    /** Reused ImageData to prevent GC allocations on progressive / live paint */
    let diffScreenImageData = null;
    /** Precomputed Gaussian vertical decay LUT (H=240) */
    const DIFF_GAUSSIAN_LUT = new Float32Array(240);
    for (let r = 0; r < 240; r += 1) {
      const v = (r / 239) * 2 - 1;
      DIFF_GAUSSIAN_LUT[r] = Math.exp(-v * v * 1.6);
    }

    /** @type {null | { col: number, W: number, H: number, half: number, color: THREE.Color, d: object, simIntensity: Float32Array|null, image: ImageData }} */
    let diffPaint = null;

    /**
     * Paint a batch of diffraction-screen columns. Returns true if more remain.
     * Prefers host SimBackend intensity samples when present.
     */
    function stepDiffractionPaint() {
      if (!diffPaint) return false;
      const job = diffPaint;
      const { W, H, half, color: colr, image } = job;
      const pixels = image.data;
      const batch = 64;
      const end = Math.min(job.col + batch, W);
      const cr = colr.r * 245;
      const cg = colr.g * 245;
      const cb = colr.b * 245;
      const stride = W * 4;
      const lut = H === 240 ? DIFF_GAUSSIAN_LUT : null;

      for (let col = job.col; col < end; col += 1) {
        const x = ((col / (W - 1)) * 2 - 1) * half;
        const intensity = intensityForPaint(x, job);
        const soft = Math.min(1, Math.pow(intensity / (intensity + 0.06), 0.8) * 1.08);
        const softCr = soft * cr;
        const softCg = soft * cg;
        const softCb = soft * cb;
        let idx = col * 4;

        for (let row = 0; row < H; row += 1) {
          const g = lut ? lut[row] : Math.exp(-(((row / (H - 1)) * 2 - 1) ** 2) * 1.6);
          pixels[idx] = 4 + (softCr * g + 0.5 | 0);
          pixels[idx + 1] = 4 + (softCg * g + 0.5 | 0);
          pixels[idx + 2] = 8 + (softCb * g + 0.5 | 0);
          pixels[idx + 3] = 255;
          idx += stride;
        }
      }
      job.col = end;
      if (job.col >= W) {
        diffScreenCtx.putImageData(image, 0, 0);
        diffScreenTex.needsUpdate = true;
        diffPaint = null;
        return false;
      }
      return true;
    }

    function flushDeferredDiffraction() {
      if (!deferredDiffraction && !diffPaint) return;
      if (deferredDiffraction) {
        const pending = deferredDiffraction;
        deferredDiffraction = null;
        updateDiffraction(pending, { force: false, syncPaint: true });
      } else {
        while (stepDiffractionPaint()) {
          /* finish partial paint */
        }
      }
    }

    function cancelDeferredDiffraction() {
      deferredDiffraction = null;
      diffPaint = null;
    }

    function animateDiffraction(t, dt) {
      if (!diffractionGroup.visible) return;
      if (diffEmitter.visible) {
        diffEmitter.scale.setScalar(1 + 0.12 * Math.sin(t * 10));
        diffHalo.material.opacity = 0.3 + 0.2 * Math.sin(t * 7);
        diffLaserLight.intensity = 0.5 + 0.18 * Math.sin(t * 7);
      }
      if (diffPaint) {
        while (stepDiffractionPaint()) {
          /* step and finish paint */
        }
      }
      if (!diffWaveGroup.visible) return;
      diffWavePhase = (diffWavePhase + dt * 2.5) % 2.2;
      diffWaveGroup.children.forEach((wave, i) => {
        const p = (diffWavePhase + i * 0.45) % 2.2;
        const radius = 0.04 + p * 0.12;
        wave.scale.set(radius, 1, radius);
        wave.material.opacity = 0.55 * (1 - p / 2.2);
      });
    }


    // Recognition targets (diffraction only)
    const recognition = {
      diff_source: addRecognitionTarget(diffSource, 'diff_source', [0.34, 0.34, 0.24], [0, 0.32, 0]),
      diff_slit: addRecognitionTarget(diffSlitMount, 'diff_slit', [0.16, 0.4, 0.42], [0, 0.36, 0]),
      diff_screen: addRecognitionTarget(diffScreen, 'diff_screen', [0.14, 0.55, 0.7], [0, 0.35, 0]),
      opt_rail: addRecognitionTarget(g, 'opt_rail', [2.2, 0.1, 0.24], [0, 0.08, 0]),
    };
    const recognitionRings = Object.fromEntries(
      Object.entries(recognition).map(([k, v]) => [k, v.outline]),
    );

    function setPartState(role, mode) {
      const ring = recognitionRings[role];
      if (!ring) return;
      if (mode === 'off') {
        ring.visible = false;
        ring.material.opacity = 0;
        return;
      }
      ring.visible = true;
      ring.material.color.setHex(mode === 'done' ? 0x4ade80 : 0xfbbf24);
      ring.material.opacity = mode === 'done' ? 0.95 : 1;
      ring.scale.setScalar(mode === 'done' ? 1.015 : 1.03);
    }

    function clearIdentifyVisuals() {
      Object.keys(recognitionRings).forEach((role) => setPartState(role, 'off'));
    }

    function setMode(mode) {
      const m = mode || 'idle';
      const geo = m === 'geometric' || isGeometricOpticsExp(m);
      // idle and diffraction both show the multi-slit bench; geometric hides it
      diffractionGroup.visible = !geo && (m === 'diffraction' || m === 'idle' || !m);
    }

    function updateOptics(d, opts = {}) {
      if (!d) return;
      if (d.mode === 'geometric' || isGeometricOpticsExp(d.expId)) {
        setMode('geometric');
        return;
      }
      setMode(d.mode === 'idle' ? 'idle' : 'diffraction');
      if (d.mode === 'idle') return;
      updateDiffraction(d, opts);
    }

    // Build diffraction once under the loader path, but leave it dark/off.
    // Idle showcase is no longer always-on (Active Station Runtime).
    updateOptics({
      mode: 'diffraction',
      lightOn: false,
      lambdaNm: 550,
      slitMm: 0.05,
      pitchMm: 0.25,
      N: 2,
      distM: 1,
      showBeam: false,
      showWave: false,
    });
    diffractionGroup.visible = false;

    g.userData.setMode = setMode;
    g.userData.updateOptics = updateOptics;
    g.userData.updateDiffraction = updateDiffraction;
    g.userData.flushDeferredDiffraction = flushDeferredDiffraction;
    g.userData.stepDiffractionPaint = stepDiffractionPaint;
    g.userData.cancelDeferredDiffraction = cancelDeferredDiffraction;
    g.userData.setPartState = setPartState;
    g.userData.clearIdentifyVisuals = clearIdentifyVisuals;
    g.userData.diffractionGroup = diffractionGroup;
    g.userData.animateDiffraction = animateDiffraction;
    return g;
  }

  const root = new THREE.Group();
  root.name = 'optics-station';
  // Push apparatus toward the back edge (−Z) so the sitting-edge strip is free
  // for the desk param panel (multi-row cards ≈0.5–0.7 m deep).
  const OPTICS_TABLE = { x: 4.2, y: 0.905, z: -3.02 };
  const optics = makeOpticsBench();
  optics.position.set(OPTICS_TABLE.x, OPTICS_TABLE.y, OPTICS_TABLE.z);
  optics.rotation.y = 0;
  root.add(optics);

  // RoomEnvironment for MeshPhysical glass/mirror (source uses PMREM RoomEnvironment).
  let geoEnvTex = null;
  try {
    if (renderer) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const rt = pmrem.fromScene(room, 0.04);
      geoEnvTex = rt.texture;
      room.dispose?.();
      pmrem.dispose();
    }
  } catch { /* optional */ }

  // Geometric optics (guangxue): optical bench + rays only (no source room floor/wall).
  // Source bench top y≈-1.35; place so scaled top sits on host tabletop y≈0.93.
  const geoRig = createGeometricOpticsRig({
    renderer,
    getEnvironment: () => geoEnvTex,
  });
  const geoScale = GEO_HOST_SCALE;
  geoRig.scale.setScalar(geoScale);
  geoRig.position.set(
    OPTICS_TABLE.x,
    OPTICS_TABLE.y + 1.35 * geoScale,
    OPTICS_TABLE.z,
  );
  geoRig.rotation.y = 0;
  geoRig.visible = false;
  // NOT added to the scene until geometric mode — keeps it out of
  // updateMatrixWorld / raycast / render lists while idle or after close.
  const geoApi = geoRig.userData.api;
  geoApi?.applyEnvironment?.(geoEnvTex);
  // Temporary parent so first matrix/ray bake has host scale; then detach.
  root.add(geoRig);
  try {
    geoRig.updateWorldMatrix?.(true, true);
    geoApi?.updateRays?.();
  } catch { /* ignore */ }
  root.remove(geoRig);
  let geoAttached = false;

  // geoFrozen tracks "not the active mode" for bookkeeping only.
  // Detach/attach is the cost model — never freeze-walk this island.
  let geoFrozen = true;
  /** Geometric GPU warm (declared early — setMode / open paths close over these). */
  let geoGpuReady = false;
  let geoWarmGen = 0;
  /** @type {Promise<boolean>|null} */
  let geoWarmPromise = null;

  /**
   * @param {boolean} on
   * @param {{ visible?: boolean }} [opts]
   *   visible=false keeps the island parented for compileAsync but OUT of the
   *   render list — first draw of uncompiled MeshPhysical freezes the whole tab.
   */
  function attachGeometricIsland(on, opts = {}) {
    if (on) {
      if (!geoAttached) {
        root.add(geoRig);
        geoAttached = true;
      }
      // Default: visible only when GPU warm is already done.
      const wantVisible = opts.visible != null ? !!opts.visible : true;
      geoRig.visible = wantVisible;
      return;
    }
    geoRig.visible = false;
    if (geoAttached) {
      root.remove(geoRig);
      geoAttached = false;
    }
  }

  // Decor on the far-right back corner — clear of the front control strip.
  const decorBeakers = [];
  [
    { o: shared.makeBeaker(0.1, 0.03, 0xaaddff), p: [5.55, 0.93, -3.25] },
    { o: shared.makeBeaker(0.09, 0.028, 0xffe8aa), p: [5.75, 0.93, -3.35] },
  ].forEach(({ o, p }) => {
    o.position.set(...p);
    root.add(o);
    decorBeakers.push(o);
  });

  let activeMode = 'idle';

  /**
   * Mode switch.
   *
   * mode:
   *  - 'geometric' | experiment id → geometric island
   *  - 'diffraction' | 'idle' → multi-slit showcase
   *  - 'off' | null → hide all (close path — no idle showcase flash)
   *
   * Geometric island is DETACHED from the scene graph when not active (not merely
   * visible=false). That is the only reliable way to stop residual cost after ×.
   */
  /**
   * @param {string|null|undefined} mode
   * @param {{ gpuReady?: boolean }} [opts]
   *   gpuReady=false → attach geometric island but keep it invisible until
   *   ensureGeometricReady() finishes (prevents whole-tab shader compile hitch).
   */
  function setMode(mode, opts = {}) {
    const m = mode == null ? 'off' : mode;
    activeMode = m;
    const off = m === 'off' || m === 'none' || m === 'hidden';
    const geo = !off && (m === 'geometric' || isGeometricOpticsExp(m));
    const showDiff = !off && !geo;
    const gpuReady = opts.gpuReady != null ? !!opts.gpuReady : geoGpuReady;

    // Drop in-flight ray rebuilds / fringe paints when leaving a mode.
    if (!geo) {
      geoWarmGen += 1; // cancel in-flight warm
      try { geoApi?.cancelDeferredRays?.(); } catch { /* ignore */ }
      try { geoApi?.setActive?.(false); } catch { /* ignore */ }
      // Detach is O(1). Never freeze-walk the geometric island on open/close.
      attachGeometricIsland(false);
      geoFrozen = true;
      labFrameScheduler.cancel?.('optics:unfreeze');
      labFrameScheduler.cancel?.('optics:freeze');
    } else {
      // Parent for compile, but hide from present until shaders are ready.
      attachGeometricIsland(true, { visible: gpuReady });
      try { geoApi?.setActive?.(true); } catch { /* ignore */ }
      geoFrozen = false;
      // World matrix once on the root only — no tree freeze walk.
      try { geoRig.updateWorldMatrix?.(true, true); } catch { /* ignore */ }
    }
    if (!showDiff) {
      optics.userData.cancelDeferredDiffraction?.();
    }

    // Hide host diffraction showcase + decor when geometric island is active
    // or when fully off (× close must not re-show diffraction for a frame).
    optics.visible = showDiff;
    decorBeakers.forEach((b) => { b.visible = showDiff; });
    if (!off) {
      if (geo) optics.userData.setMode?.('geometric');
      else optics.userData.setMode?.(m === 'idle' ? 'idle' : m);
    } else {
      optics.userData.setMode?.('idle');
      if (optics.userData.diffractionGroup) {
        optics.userData.diffractionGroup.visible = false;
      }
    }
  }

  function geoParamsFromData(data) {
    return {
      shape: data.shape,
      angle: data.angle,
      height: data.height,
      rayCount: data.rayCount,
      ior: data.ior,
      dispersion: data.dispersion,
      dispersionStrength: data.dispersionStrength,
      rotate: data.rotate,
      showReflect: data.showReflect,
      mode: data.opticsMode || (data.mode === 'mirror' || data.mode === 'dielectric' ? data.mode : undefined),
    };
  }

  /**
   * @param {object} data
   * @param {{ force?: boolean, defer?: boolean, deferRays?: boolean, keepRays?: boolean }} [opts]
   *   defer / deferRays: mesh now, full trace on next animator tick (experiment switch).
   *   keepRays: live drag — leave previous beams until progressive rebuild.
   */
  function updateGeometric(data, opts = {}) {
    if (!data || !geoApi) return geoApi?.snapshot?.() || null;
    const deferRays = !!(opts.defer || opts.deferRays);
    return geoApi.applyParams(geoParamsFromData(data), {
      force: !!opts.force,
      deferRays,
      keepRays: !!opts.keepRays,
    });
  }

  function flushDeferredGeometry() {
    if (!geoAttached || !geoRig.visible || !geoApi) return null;
    if (!geoApi.raysPending) return geoApi.snapshot?.() || null;
    return geoApi.flushDeferredRays?.() || null;
  }

  /** One beam; returns true if more remain. For scheduleCoop. */
  function stepDeferredGeometry() {
    if (!geoAttached || !geoRig.visible || !geoApi) return false;
    if (typeof geoApi.stepRayBuild === 'function') {
      if (!geoApi.raysPending) return false;
      return !!geoApi.stepRayBuild();
    }
    flushDeferredGeometry();
    return false;
  }

  function cancelDeferred() {
    // Drop pending geometric ray rebuild + diffraction canvas paint so a
    // mid-switch exit cannot flush the previous experiment's config later.
    try {
      geoApi?.cancelDeferredRays?.();
    } catch { /* ignore */ }
    optics.userData.cancelDeferredDiffraction?.();
  }

  /**
   * GPU warm gate for geometric optics.
   * Shaders compile while the island is parented but NOT rendered (visible=false).
   * Revealing only after warm means the next present does not sync-compile and
   * freeze the whole browser tab.
   */
  function revealGeometricIsland() {
    if (!geoAttached) attachGeometricIsland(true, { visible: true });
    else geoRig.visible = true;
    try { geoApi?.setActive?.(true); } catch { /* ignore */ }
  }

  /**
   * @param {{ onReady?: (ok: boolean) => void, force?: boolean }} [opts]
   * @returns {Promise<boolean>}
   */
  function ensureGeometricReady(opts = {}) {
    const t0 = performance.now();
    console.log(`[open-trace] ensureGeometricReady begin ready=${geoGpuReady}`);
    const onReady = typeof opts.onReady === 'function' ? opts.onReady : null;
    // Boot prewarm calls this once for each default geometric experiment. A
    // single global ready flag cannot certify mirror/prism/lens variants.
    if (opts.force) {
      geoWarmGen += 1;
      geoWarmPromise = null;
      geoGpuReady = false;
    }
    if (geoGpuReady) {
      revealGeometricIsland();
      onReady?.(true);
      return Promise.resolve(true);
    }
    if (geoWarmPromise) {
      return geoWarmPromise.then((ok) => {
        if (ok) revealGeometricIsland();
        onReady?.(!!ok);
        return ok;
      });
    }

    const gen = (geoWarmGen += 1);
    // Parent + hide: compile can see the graph; present will not draw it.
    attachGeometricIsland(true, { visible: false });
    geoFrozen = false;
    try { geoRig.updateWorldMatrix?.(true, true); } catch { /* ignore */ }

    const finish = (ok) => {
      if (gen !== geoWarmGen) return false;
      geoWarmPromise = null;
      console.log(`[open-trace] ensureGeometricReady finish ok=${ok} +${(performance.now() - t0).toFixed(1)}ms`);
      if (ok) {
        geoGpuReady = true;
        revealGeometricIsland();
      }
      onReady?.(!!ok);
      return !!ok;
    };

    const renderer = ctx.renderer;
    if (!renderer || !geoRig) {
      return Promise.resolve(finish(false));
    }

    // Double-rAF so the current click frame paints HUD/toast first.
    geoWarmPromise = new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (gen !== geoWarmGen) {
            resolve(false);
            return;
          }
          const runSyncCompile = () => {
            const tC = performance.now();
            console.log(`[open-trace] renderer.compile SYNC begin`);
            try {
              // Yield once more after a long compile so chrome can composite.
              renderer.compile(geoRig, ctx.camera, ctx.scene);
              console.log(`[open-trace] renderer.compile SYNC end dt=${(performance.now() - tC).toFixed(1)}ms`);
              resolve(finish(true));
            } catch (err) {
              console.log(`[open-trace] renderer.compile SYNC fail`, err);
              resolve(finish(false));
            }
          };

          if (typeof renderer.compileAsync === 'function') {
            try {
              console.log(`[open-trace] renderer.compileAsync begin`);
              const tA = performance.now();
              const p = renderer.compileAsync(geoRig, ctx.camera, ctx.scene);
              if (p && typeof p.then === 'function') {
                p.then(() => {
                  console.log(`[open-trace] renderer.compileAsync ok dt=${(performance.now() - tA).toFixed(1)}ms`);
                  resolve(finish(true));
                }).catch((err) => {
                  console.log(`[open-trace] renderer.compileAsync fail`, err);
                  // Fallback sync compile on a later frame (never on the click stack).
                  requestAnimationFrame(runSyncCompile);
                });
                return;
              }
            } catch { /* fall through */ }
          }
          // No compileAsync: still delay sync compile off the click frame.
          runSyncCompile();
        });
      });
    });

    return geoWarmPromise;
  }

  /** @deprecated use ensureGeometricReady */
  function compileGeometricGpu() {
    if (geoGpuReady) return true;
    ensureGeometricReady();
    return geoGpuReady;
  }

  /** Museum idle: multi-slit bench lit on the table (static when station is cold). */
  function showIdleShowcase() {
    setMode('idle');
    try {
      optics.userData.updateDiffraction?.({
        mode: 'diffraction',
        lightOn: true,
        lambdaNm: 550,
        slitMm: 0.05,
        pitchMm: 0.25,
        N: 2,
        distM: 1,
        showBeam: true,
        showWave: true,
      }, { force: false });
    } catch { /* ignore */ }
  }

  const equipment = {
    setMode,
    /** Hide geometric + diffraction (experiment switch only). */
    hideAll: () => setMode('off'),
    /** Active Station Runtime: clear the tabletop while the station is idle. */
    showcase: () => setMode('off'),
    shutdown: () => setMode('off'),
    suspend: () => setMode('off'),
    resume: () => { /* experiment applyVisualDefaults picks geometric/diffraction */ },
    compileGeometricGpu,
    ensureGeometricReady,
    revealGeometricIsland,
    get geoGpuReady() { return geoGpuReady; },
    get geoWarming() { return !!geoWarmPromise && !geoGpuReady; },
    get geoRig() { return geoRig; },
    updateOptics: (data, opts = {}) => {
      if (data?.mode === 'geometric' || isGeometricOpticsExp(data?.expId)) {
        setMode('geometric', { gpuReady: geoGpuReady });
        return updateGeometric(data, opts);
      }
      setMode(data?.mode === 'idle' ? 'idle' : 'diffraction');
      return optics.userData.updateOptics?.(data, opts);
    },
    updateGeometric,
    flushDeferredGeometry,
    stepDeferredGeometry,
    flushDeferredDiffraction: () => optics.userData.flushDeferredDiffraction?.(),
    stepDiffractionPaint: () => optics.userData.stepDiffractionPaint?.() || false,
    cancelDeferred,
    snapshotGeometric: () => geoApi?.snapshot?.() || null,
    setPartState: (part, mode) => optics.userData.setPartState?.(part, mode),
    clearIdentifyVisuals: () => optics.userData.clearIdentifyVisuals?.(),
    getCamera: () => ctx.camera,
    mouseDrag: { holdLMB: false, movementX: 0 },
    get activeMode() { return activeMode; },
    geoRig,
  };

  function defaultGeoData(expId) {
    const exp = getGeometricExperiment(expId);
    const cfg = resolveExperimentConfig(expId, exp?.defaultModule) || exp?.config || {};
    const shape = cfg.shape || 'mirror';
    const opticsMode = cfg.mode || (shape.startsWith('mirror') ? 'mirror' : 'dielectric');
    return {
      shape,
      angle: cfg.angle ?? 35,
      height: cfg.height ?? 0,
      rayCount: cfg.rayCount ?? 1,
      ior: cfg.ior ?? 1.52,
      dispersion: !!cfg.dispersion,
      dispersionStrength: cfg.dispersionStrength ?? 0.6,
      rotate: cfg.rotate ?? 0,
      showReflect: cfg.showReflect !== false,
      opticsMode,
      mode: opticsMode,
    };
  }

  // Default: clear tabletop; experiment assets are mounted after selection.
  setMode('off');

  return {
    root,
    equipment,
    animators: [
      (t, dt) => {
        // Only animate the active apparatus family — never both, never when off.
        if (geoAttached && geoRig.visible) {
          // Never flushDeferredGeometry on the pre-render path — full raytrace
          // freezes the camera. Flush only via labFrameScheduler (optics:ray-flush).
          geoApi?.animate?.(t);
          return;
        }
        if (optics.visible && optics.userData.diffractionGroup?.visible) {
          optics.userData.animateDiffraction?.(t, dt);
        }
      },
    ],
    // Intent/open path owns compileAsync + 1×1 present; no boot prewarm map.
    refs: { optics, geoRig },
  };
}
