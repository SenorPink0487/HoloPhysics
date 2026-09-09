import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { labFrameScheduler } from '../../frameBudget.js';
import { createHallDemoEquipment } from '../../experiments/hallDemoEquipment.js';
import { createElectricFieldEquipment } from '../../experiments/electricFieldEquipment.js';
import { createInducedElectricFieldEquipment } from '../../experiments/inducedElectricFieldEquipment.js';
import {
  gaussFluxParticleEmphasis,
  gaussFluxParticleRadiusNorm,
  gaussFluxParticleSpeed,
  gaussNormalFluxDensity,
} from '../../experiments/electro.js';
import { drawMathFormula } from '../../physicsFormula.js';
import { createPrimitives } from '../shared/primitives.js';
import { createInstancedArrowField } from '../shared/instancedBatch.js';
import { createEquipmentRuntime, getLeafPickSet, estimateObjectBytes } from '../../runtime/experimentRuntime.js';

/**
 * The electro bench is the first physics station in the boot order, so build
 * its complete apparatus while the startup loader is still covering the lab.
 * This prevents the first experiment click from monopolising the main thread
 * with Hall / field-line / Faraday / induced-field constructors.
 */
export function createStationEquipment(ctx) {
  const { THREE } = ctx;
  const root = new THREE.Group();
  root.name = 'electro-station';
  let full = null;

  const hallBench = new THREE.Group();
  hallBench.userData.getHallTerminalTarget = (...args) => (
    full?.refs?.hallBench?.userData?.getHallTerminalTarget?.(...args) || null
  );
  const ensureFull = () => {
    if (full) return full;
    try {
      full = createFullStationEquipment(ctx);
      root.add(full.root);
      console.log('[Electro] Full station created successfully');
      return full;
    } catch (err) {
      console.error('[Electro] Failed to create full station:', err);
      throw err;
    }
  };
  const call = (method, ...args) => full?.equipment?.[method]?.(...args);
  const modeFor = (id) => ({
    hall_effect: 'hall',
    hall_carrier_demo: 'hall-demo',
    gauss_theorem: 'gauss',
    electric_field: 'electric-field',
    faraday_induction: 'faraday',
    induced_electric_field: 'induced-e',
  })[id] || null;
  const runtimeRootFor = (id) => full?.equipment?.getRuntimeRoot?.(modeFor(id)) || full?.root;
  const createRuntime = (id) => {
    ensureFull();
    const resolveRoot = () => runtimeRootFor(id) || full.root;
    const ensureRuntimeMounted = () => {
      const target = resolveRoot();
      const owner = full?.refs?.hallBench;
      if (target && owner && target.parent !== owner) owner.add(target);
      if (target) target.visible = true;
      return target;
    };
    return createEquipmentRuntime({
      id,
      root: resolveRoot(),
      getRoot: resolveRoot,
      prepare: async (_prepareContext, signal) => {
        ensureFull();
        if (signal?.aborted) throw abortError();
      },
      prepareRoot: resolveRoot,
      mount: (_parent, target) => { if (target) target.visible = true; },
      activate: () => {
        full?.equipment?.setMode?.(modeFor(id));
        // Mode groups are intentionally detached while idle. The activation
        // commit must own the final parent operation so an earlier prewarm or
        // station-presence cleanup cannot leave an active runtime invisible.
        ensureRuntimeMounted();
      },
      suspend: () => {
        if (full?.equipment?.activeMode === modeFor(id)) full.equipment.setMode?.(null);
      },
      unmount: () => {},
      getPickSet: () => getLeafPickSet(runtimeRootFor(id)),
      estimateBytes: () => estimateObjectBytes(runtimeRootFor(id)),
      dispose: () => { if (full?.equipment?.activeMode === modeFor(id)) full.equipment.setMode?.(null); },
    });
  };
  const equipment = {
    prepareExperiment: () => ensureFull(),
    createRuntime,
    getHallProbePos: (...args) => call('getHallProbePos', ...args),
    setMode: (mode) => mode ? ensureFull().equipment.setMode(mode) : call('setMode', null),
    prewarmGpu: (...args) => ensureFull().equipment.prewarmGpu?.(...args),
    showcase: () => call('showcase'),
    shutdown: () => call('shutdown'),
    suspend: () => call('suspend'),
    resume: () => call('resume'),
    updateHall: (...args) => call('updateHall', ...args),
    updateHallDemo: (...args) => call('updateHallDemo', ...args),
    updateGauss: (...args) => call('updateGauss', ...args),
    updateElectricField: (...args) => call('updateElectricField', ...args),
    updateFaraday: (...args) => call('updateFaraday', ...args),
    updateInducedElectric: (...args) => call('updateInducedElectric', ...args),
    startHallWirePreview: (...args) => call('startHallWirePreview', ...args),
    updateHallWirePreview: (...args) => call('updateHallWirePreview', ...args),
    cancelHallWirePreview: (...args) => call('cancelHallWirePreview', ...args),
    setHallPartState: (...args) => call('setHallPartState', ...args),
    clearHallIdentifyVisuals: (...args) => call('clearHallIdentifyVisuals', ...args),
    getCamera: () => ctx.camera,
    getRuntimeRoot: (mode) => full?.equipment?.getRuntimeRoot?.(mode) || full?.root || root,
    getRoot: () => full?.root || root,
    root,
    get activeMode() { return full?.equipment?.activeMode || null; },
    mouseDrag: { holdLMB: false, movementX: 0, movementY: 0, shiftKey: false },
  };
  // Keep the loader's animator registration stable while the station is
  // constructed and GPU-warmed during boot.
  const animators = [(_t, _dt) => {
    full?.animators?.forEach((animate) => animate(_t, _dt));
  }];
  // Ensure full is created immediately so opening doesn't fail later
  ensureFull();
  return { root, equipment, animators, refs: { hallBench } };
}

function abortError() {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

/** Build and expose all electromagnetism-station apparatus. */
function createFullStationEquipment(ctx) {
  const { THREE, scene, camera, renderer, materials: mat } = ctx;
  const primitives = ctx.primitives || createPrimitives();
  const { rbox, box, cyl } = primitives;
  const animators = [];

  // —— Gauss-theorem closed-surface apparatus ——
  function createGaussEquipment() {
    const root = createElectricFieldEquipment();
    const origUpdate = root.userData.update;
    root.userData.update = (data, dt) => {
      if (!data) return;
      origUpdate({
        ...data,
        isGaussTheorem: true,
        showGaussSurface: true,
        showArrows: false,
      }, dt);
    };
    return root;
  }

  // —— Hall-effect magnetic-field bench ——
  function makeHallSetup() {
    const g = new THREE.Group();
    // ── Lab materials (matte / metallic, not neon toy glow) ──
    const lab = {
      brass: new THREE.MeshStandardMaterial({
        color: 0xc9a227, metalness: 0.95, roughness: 0.28, emissive: 0x3d3008, emissiveIntensity: 0.1,
      }),
      steel: new THREE.MeshStandardMaterial({
        color: 0x9aa3ad, metalness: 0.9, roughness: 0.28, emissive: 0x111418, emissiveIntensity: 0.05,
      }),
      paper: new THREE.MeshStandardMaterial({
        color: 0xf5f0e6, metalness: 0.02, roughness: 0.85, emissive: 0x222018, emissiveIntensity: 0.04,
      }),
      rubberRed: new THREE.MeshStandardMaterial({
        color: 0x991b1b, metalness: 0.05, roughness: 0.75, emissive: 0x2a0505, emissiveIntensity: 0.08,
      }),
      rubberBlack: new THREE.MeshStandardMaterial({
        color: 0x111111, metalness: 0.08, roughness: 0.72, emissive: 0x050505, emissiveIntensity: 0.06,
      }),
    };

    function bindingPost(x, y, z, colorMat, role, portId, wireColor) {
      const grp = new THREE.Group();
      grp.position.set(x, y, z);
      const socket = cyl(0.018, 0.018, 0.008, colorMat, 24);
      socket.position.y = 0.004;
      grp.add(socket);
      const body = cyl(0.007, 0.007, 0.018, lab.brass, 16);
      body.position.y = 0.015;
      grp.add(body);
      const nut = cyl(0.012, 0.012, 0.007, lab.brass, 16);
      nut.position.y = 0.025;
      grp.add(nut);
      const socketHole = cyl(0.005, 0.005, 0.004, lab.rubberBlack, 16);
      socketHole.position.y = 0.031;
      grp.add(socketHole);

      const plug = new THREE.Group();
      const plugPin = cyl(0.0045, 0.0045, 0.018, lab.brass, 14);
      plugPin.position.y = 0.038;
      plug.add(plugPin);
      const plugSleeve = cyl(0.009, 0.011, 0.024, colorMat, 18);
      plugSleeve.position.y = 0.053;
      plug.add(plugSleeve);
      plug.visible = false;
      grp.add(plug);

      if (role) {
        grp.userData.interactive = true;
        grp.userData.role = role;
        grp.userData.portId = portId;
        grp.userData.wireColor = wireColor;
        grp.userData.plug = plug;
        // Keep the mouse hit volume close to the visible socket.  AR gets its
        // separate forgiving nearest-port fallback below, so this proxy mus
        // not grow large enough to shadow nearby mouse controls.
        const hit = new THREE.Mesh(
          new THREE.BoxGeometry(0.055, 0.07, 0.055),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        hit.position.y = 0.03;
        hit.userData.interactive = true;
        hit.userData.role = role;
        hit.userData.portId = portId;
        grp.add(hit);
      }
      return grp;
    }

    // ═══ HCC-2 Hall-effect magnetic-field bench ═══
    // Faithful compact reconstruction of the original Hall project: the long
    // solenoid, Helmholtz pair, transparent guide tube, ruler/probe and the
    // three-readout HCC-2 console remain visible as one complete instrument.
    const hallGroup = new THREE.Group();
    hallGroup.visible = true;

    const deckMat = new THREE.MeshStandardMaterial({ color: 0xd6d8da, metalness: 0.16, roughness: 0.48 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x08090b, metalness: 0.28, roughness: 0.55 });
    const hallLeftCopper = new THREE.MeshStandardMaterial({
      color: 0xb85b27, metalness: 0.82, roughness: 0.34,
      emissive: 0x321006, emissiveIntensity: 0.08,
    });
    const hallRightCopper = hallLeftCopper.clone();
    const acrylic = new THREE.MeshPhysicalMaterial({
      color: 0xe8f7ff, transparent: true, opacity: 0.24,
      clearcoat: 0.8, clearcoatRoughness: 0.1,
      roughness: 0.08, side: THREE.DoubleSide, depthWrite: false,
    });

    const hallBase = rbox(1.28, 0.08, 0.8, deckMat, 0.014);
    hallBase.position.y = 0.04;
    hallGroup.add(hallBase);

    // Long solenoid across the rear, always present just like the source model.
    // Full turn count N drawn procedurally with fwidth AA (no moiré). Wire
    // bump normals + roughness/metal variation restore copper depth and sheen.
    const hallSolenoid = new THREE.Group();
    hallSolenoid.position.set(0, 0.245, -0.24);
    const solTube = cyl(0.056, 0.056, 1.04, acrylic, 64);
    solTube.rotation.z = Math.PI / 2;
    hallSolenoid.add(solTube);

    const solWindUniforms = {
      uTurns: { value: 100 },
    };

    // Soft studio env so copper metalness has something to reflect (no scene env map)
    function makeSolenoidEnvMap() {
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 256;
      const ctx = c.getContext('2d');
      const sky = ctx.createLinearGradient(0, 0, 0, 256);
      sky.addColorStop(0, '#e8eef8');
      sky.addColorStop(0.42, '#8a96a8');
      sky.addColorStop(0.55, '#3a4250');
      sky.addColorStop(1, '#1a1412');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 512, 256);
      // Key ligh
      ctx.fillStyle = 'rgba(255, 252, 245, 0.55)';
      ctx.beginPath();
      ctx.ellipse(160, 70, 70, 36, 0, 0, Math.PI * 2);
      ctx.fill();
      // Warm fill (lab bounce)
      ctx.fillStyle = 'rgba(255, 170, 90, 0.4)';
      ctx.beginPath();
      ctx.ellipse(360, 190, 100, 50, 0, 0, Math.PI * 2);
      ctx.fill();
      // Cool rim
      ctx.fillStyle = 'rgba(140, 190, 255, 0.22)';
      ctx.beginPath();
      ctx.ellipse(420, 60, 50, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    }
    const solEnvMap = makeSolenoidEnvMap();

    const solWindMat = new THREE.MeshStandardMaterial({
      color: 0xd4894a,
      metalness: 0.9,
      roughness: 0.28,
      emissive: 0x3a1206,
      emissiveIntensity: 0.1,
      envMap: solEnvMap,
      envMapIntensity: 0.95,
    });
    solWindMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTurns = solWindUniforms.uTurns;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vSolUv;
          varying vec3 vSolAxis;
          varying vec3 vSolCirc;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float axis = uv.y;
            float ang = atan(position.z, position.x);
            vSolUv = vec2(ang * 0.15915494309, axis);
            vec3 oRadial = normalize(vec3(position.x, 0.0, position.z) + vec3(1e-6, 0.0, 0.0));
            vec3 oAxis = vec3(0.0, 1.0, 0.0);
            vec3 oCirc = normalize(cross(oAxis, oRadial));
            vSolAxis = normalize(normalMatrix * oAxis);
            vSolCirc = normalize(normalMatrix * oCirc);
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTurns;
          varying vec2 vSolUv;
          varying vec3 vSolAxis;
          varying vec3 vSolCirc;
          // Shared wind profile for color / normal / roughness (set in color_fragment)
          float solDetail;
          float solRidge;
          float solSin;
          float solCos;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float turns = max(uTurns, 1.0);
            float phase = vSolUv.y * turns + vSolUv.x;
            float fw = max(fwidth(phase), 1e-4);
            float pxPerTurn = 1.0 / fw;
            // Full N when readable; fade only when undersampled (anti-moiré)
            solDetail = smoothstep(1.15, 2.9, pxPerTurn);
            float ang = phase * 6.28318530718;
            solCos = cos(ang);
            solSin = sin(ang);
            // Round enamel-wire cross-section (crest = wire body, trough = groove)
            solRidge = 0.5 + 0.5 * solCos;
            float micro = 0.5 + 0.5 * cos(ang * 2.0);
            float ridge = solRidge * 0.82 + micro * 0.18;
            float tone = mix(0.52, ridge, solDetail);
            // Deep contact shadow between turns
            float ao = mix(1.0, mix(0.42, 1.0, pow(max(solRidge, 0.0), 0.55)), solDetail);
            vec3 darkC = vec3(0.32, 0.12, 0.04);
            vec3 midC  = vec3(0.78, 0.44, 0.17);
            vec3 litC  = vec3(1.0, 0.78, 0.48);
            vec3 wind = mix(darkC, midC, smoothstep(0.1, 0.48, tone));
            wind = mix(wind, litC, smoothstep(0.48, 0.9, tone));
            // Specular copper edge on the wire crown
            wind = mix(wind, vec3(1.0, 0.88, 0.65), 0.18 * pow(solRidge, 2.0) * solDetail);
            diffuseColor.rgb = wind * ao;
          }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          {
            // Bright metal crowns, softer enamel in the valleys
            float rPeak = 0.14;
            float rValley = 0.55;
            roughnessFactor = mix(0.34, mix(rValley, rPeak, pow(solRidge, 1.35)), solDetail);
          }`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          {
            metalnessFactor = mix(0.78, mix(0.72, 0.96, solRidge), solDetail);
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            // Strong round-wire bump: each turn reads as a tube, not a flat stripe
            float bump = 1.15 * solDetail;
            float axialGain = clamp(uTurns * 0.014, 0.55, 1.85);
            float axial = solSin * bump * axialGain;
            float circ = solSin * bump * 0.38;
            float lift = solCos * bump * 0.55;
            // Slight helical twist on the normal for continuous-wire feel
            float twist = solCos * bump * 0.12;
            vec3 T = normalize(vSolAxis);
            vec3 B = normalize(vSolCirc);
            vec3 N = normalize(normal);
            vec3 nW = normalize(
              N * (1.0 + lift)
              - T * axial
              - B * (circ + twist)
            );
            normal = normalize(mix(N, nW, solDetail));
          }`,
        );
    };
    solWindMat.customProgramCacheKey = () => 'hall-solenoid-wind-aa-v5';

    // Corrugated radial profile gives real geometric depth (still one mesh, full N)
    function makeSolenoidWindGeometry(turns, length = 1.04, radius = 0.063, wireAmp = 0.0032) {
      const n = Math.round(THREE.MathUtils.clamp(turns, 10, 300));
      // ≥2 segs per turn so the sine profile is smooth; AA still handled in shader
      const heightSegs = Math.max(48, n * 2);
      const radialSegs = 64;
      const geo = new THREE.CylinderGeometry(radius, radius, length, radialSegs, heightSegs, true);
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const v = new THREE.Vector3();
      const rad = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        // Local Y is axis; map to 0..1 then to phase of N turns
        const t = THREE.MathUtils.clamp(v.y / length + 0.5, 0, 1);
        const ang = Math.atan2(v.z, v.x);
        const phase = t * n + ang / (Math.PI * 2);
        const ridge = Math.cos(phase * Math.PI * 2);
        const r = Math.hypot(v.x, v.z) || radius;
        const r2 = radius + wireAmp * ridge;
        const s = r2 / r;
        v.x *= s;
        v.z *= s;
        pos.setXYZ(i, v.x, v.y, v.z);
        // Approximate normal for round wire (outward + axial tilt)
        rad.set(v.x, 0, v.z).normalize();
        const dPhase = -Math.sin(phase * Math.PI * 2);
        const nrm = rad
          .clone()
          .multiplyScalar(1)
          .addScaledVector(new THREE.Vector3(0, 1, 0), dPhase * wireAmp * n * 0.35)
          .normalize();
        nor.setXYZ(i, nrm.x, nrm.y, nrm.z);
      }
      pos.needsUpdate = true;
      nor.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    }

    let solWindBody = new THREE.Mesh(makeSolenoidWindGeometry(100), solWindMat);
    solWindBody.castShadow = true;
    solWindBody.receiveShadow = true;
    solWindBody.rotation.z = Math.PI / 2;
    hallSolenoid.add(solWindBody);

    let lastHallTurns = -1;
    function setHallSolenoidTurns(turns) {
      const count = Math.round(THREE.MathUtils.clamp(Number(turns || 2340), 10, 5000));
      if (count === lastHallTurns) return;
      lastHallTurns = count;
      // Full N in both shader and corrugated geometry
      solWindUniforms.uTurns.value = count;
      const prev = solWindBody.geometry;
      solWindBody.geometry = makeSolenoidWindGeometry(count);
      prev.dispose();
    }
    setHallSolenoidTurns(2340);

    const solenoidSupportMat = new THREE.MeshStandardMaterial({
      color: 0x20282b,
      metalness: 0.52,
      roughness: 0.38,
    });
    const solenoidEndMat = new THREE.MeshPhysicalMaterial({
      color: 0x9bb8bd,
      transparent: true,
      opacity: 0.58,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
      metalness: 0.18,
      roughness: 0.3,
      side: THREE.DoubleSide,
    });

    // Symmetrical end assemblies: a closed face and short collar flow into a
    // rounded cradle, then a slim stem and foot transfer the load to the deck.
    for (const sx of [-1, 1]) {
      const endX = sx * 0.52;

      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.071, 0.071, 0.03, 48, 1, true),
        solenoidSupportMat,
      );
      collar.rotation.z = Math.PI / 2;
      collar.position.x = endX;
      hallSolenoid.add(collar);

      const endFace = new THREE.Mesh(new THREE.CircleGeometry(0.058, 48), solenoidEndMat);
      endFace.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      endFace.position.x = sx * 0.536;
      hallSolenoid.add(endFace);

      const cradle = new THREE.Mesh(
        new THREE.TorusGeometry(0.063, 0.009, 10, 48),
        solenoidSupportMat,
      );
      cradle.rotation.y = Math.PI / 2;
      cradle.position.x = endX;
      hallSolenoid.add(cradle);

      const stem = rbox(0.042, 0.078, 0.07, solenoidSupportMat, 0.012);
      stem.position.set(endX, -0.112, 0);
      hallSolenoid.add(stem);

      const foot = rbox(0.1, 0.024, 0.15, solenoidSupportMat, 0.012);
      foot.position.set(endX, -0.164, 0);
      hallSolenoid.add(foot);
    }
    hallGroup.add(hallSolenoid);

    // Helmholtz coils: thick multi-layer copper windings and clear flanges.
    const hallHelm = new THREE.Group();
    hallHelm.position.set(-0.04, 0.28, -0.02);
    function makeHallCoil(copperMat = hallLeftCopper) {
      const cg = new THREE.Group();
      const widthTurns = 20;
      const layerTurns = 12;
      const windings = new THREE.InstancedMesh(
        new THREE.TorusGeometry(1, 0.014, 6, 48), copperMat, widthTurns * layerTurns,
      );
      const dummy = new THREE.Object3D();
      let idx = 0;
      for (let layer = 0; layer < layerTurns; layer++) {
        const radius = 0.1 + layer * ((0.132 - 0.1) / layerTurns);
        for (let w = 0; w < widthTurns; w++) {
          dummy.position.set(-0.02 + w * (0.04 / widthTurns), 0, 0);
          dummy.rotation.set(0, Math.PI / 2, 0);
          dummy.scale.setScalar(radius);
          dummy.updateMatrix();
          windings.setMatrixAt(idx++, dummy.matrix);
        }
      }
      windings.instanceMatrix.needsUpdate = true;
      cg.add(windings);
      for (const sx of [-1, 1]) {
        const flange = new THREE.Mesh(new THREE.RingGeometry(0.096, 0.152, 64), acrylic);
        flange.rotation.y = Math.PI / 2;
        flange.position.x = sx * 0.024;
        cg.add(flange);
      }
      const drum = cyl(0.096, 0.096, 0.048, acrylic, 64);
      drum.rotation.z = Math.PI / 2;
      cg.add(drum);
      const foot = rbox(0.06, 0.16, 0.085, blackMat, 0.004);
      foot.position.y = -0.19;
      cg.add(foot);
      return cg;
    }
    const hallLeftCoil = makeHallCoil(hallLeftCopper);
    hallLeftCoil.position.x = -0.1;
    const hallRightCoil = makeHallCoil(hallRightCopper);
    hallRightCoil.position.x = 0.1;
    hallHelm.add(hallLeftCoil, hallRightCoil);
    hallGroup.add(hallHelm);

    // Transparent measuring tube runs through the Helmholtz pair.
    const guideTube = cyl(0.032, 0.032, 1.4, acrylic, 32);
    guideTube.rotation.z = Math.PI / 2;
    guideTube.position.set(0.04, 0.28, -0.02);
    hallGroup.add(guideTube);

    // Sliding white ruler and red Hall sensor; probe moves between both objects.
    const hallProbe = new THREE.Group();
    hallProbe.position.set(0, 0.28, -0.02);
    const probeRodLen = 1.4;
    const probeRod = rbox(probeRodLen, 0.016, 0.032, lab.paper, 0.002);
    probeRod.position.x = probeRodLen / 2;
    hallProbe.add(probeRod);
    const tickCount = 351;
    const tickGeometry = new THREE.BoxGeometry(0.0012, 0.0015, 0.012);
    const ticks = new THREE.InstancedMesh(tickGeometry, blackMat, tickCount);
    const tickDummy = new THREE.Object3D();
    for (let i = 0; i < tickCount; i++) {
      const scaleZ = i % 10 === 0 ? 2.4 : i % 5 === 0 ? 1.7 : 1;
      tickDummy.position.set(i * (1.36 / (tickCount - 1)), 0.009, 0);
      tickDummy.scale.set(1, 1, scaleZ);
      tickDummy.updateMatrix();
      ticks.setMatrixAt(i, tickDummy.matrix);
    }
    ticks.instanceMatrix.needsUpdate = true;
    hallProbe.add(ticks);
    const sensorTip = rbox(0.036, 0.028, 0.035, new THREE.MeshStandardMaterial({
      color: 0xd71920, emissive: 0x68070a, emissiveIntensity: 0.42,
    }), 0.003);
    sensorTip.position.x = -0.02;
    hallProbe.add(sensorTip);
    hallGroup.add(hallProbe);

    function makeHallReadout(label, initial) {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 140;
      const cx = canvas.getContext('2d');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshStandardMaterial({ map: texture, emissive: 0x5a0000, emissiveIntensity: 0.65, roughness: 0.24 });
      let lastValue = null;
      const paint = (value) => {
        if (value === lastValue) return;
        lastValue = value;
        cx.fillStyle = '#090202'; cx.fillRect(0, 0, 320, 140);
        cx.strokeStyle = '#3f4044'; cx.lineWidth = 8; cx.strokeRect(4, 4, 312, 132);
        cx.fillStyle = '#ff2028'; cx.font = 'bold 64px "Microsoft YaHei", sans-serif'; cx.textAlign = 'center';
        cx.fillText(value, 160, 78);
        cx.fillStyle = '#72757a'; cx.font = '20px "Microsoft YaHei", sans-serif'; cx.fillText(label, 160, 118);
        texture.needsUpdate = true;
      };
      paint(initial);
      return { material, paint };
    }

    const readoutDefs = [
      makeHallReadout('励磁电流 Im(A)', '0.500'),
      makeHallReadout('霍尔电流 Is(A)', '0.005'),
      makeHallReadout('霍尔电压 VH(mV)', '0.00'),
    ];
    const hallKnobs = [];
    readoutDefs.forEach((readout, i) => {
      const x = -0.38 + i * 0.38;
      const bezel = rbox(0.29, 0.018, 0.12, blackMat, 0.005);
      bezel.position.set(x, 0.095, 0.2);
      hallGroup.add(bezel);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.1), readout.material);
      face.rotation.x = -Math.PI / 2;
      face.position.set(x, 0.106, 0.2);
      hallGroup.add(face);
      const knob = cyl(0.034, 0.038, 0.022, lab.steel, 22);
      knob.position.set(x, 0.1, 0.32);
      const knobRole = i === 0 ? 'hall_knob_im' : i === 1 ? 'hall_knob_is' : 'hall_knob_zero';
      knob.userData.interactive = true;
      knob.userData.role = knobRole;
      const knobHit = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.08, 0.09),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      knobHit.userData.interactive = true;
      knobHit.userData.role = knobRole;
      knob.add(knobHit);
      const indicator = rbox(0.008, 0.004, 0.032, lab.paper, 0.001);
      indicator.position.set(0, 0.014, 0.017);
      knob.add(indicator);
      hallGroup.add(knob);
      hallKnobs.push(knob);
    });

    // Terminal rows: solenoid (2), helmholtz (3: common/ground, fixed L1, moving L2), output (2).
    // Sockets are positioned directly onto the schematic nodes (Col 1: -0.58, Col 2: -0.51, Col 3: -0.44).
    function makeTerminalLabel(primary, secondary, z, kind) {
      const canvas = document.createElement('canvas');
      canvas.width = 920; canvas.height = 140;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#30383d';
      ctx.fillStyle = '#30383d';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const Y = 70;

      if (kind === 'solenoid') {
        // Line from left socket (X=40) to coil (X=110)
        ctx.beginPath();
        ctx.moveTo(40, Y);
        ctx.lineTo(110, Y);
        // 7 zigzags between 110 and 250
        for (let i = 0; i < 7; i++) {
          ctx.lineTo(110 + (i + 1) * 20, Y + (i % 2 === 0 ? -18 : 18));
        }
        ctx.lineTo(270, Y);
        ctx.lineTo(320, Y);
        ctx.stroke();

        ctx.font = 'italic 30px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('L', 180, Y - 26);
      } else if (kind === 'helmholtz') {
        // Line from left socket (X=40) to coil L1 (X=65)
        ctx.beginPath();
        ctx.moveTo(40, Y);
        ctx.lineTo(65, Y);
        // Coil L1: 4 zigzags between 65 and 145
        for (let i = 0; i < 4; i++) {
          ctx.lineTo(65 + (i + 1) * 20, Y + (i % 2 === 0 ? -16 : 16));
        }
        ctx.lineTo(155, Y);
        ctx.lineTo(180, Y); // Connects to middle socket (X=180)
        ctx.lineTo(205, Y);
        // Coil L2: 4 zigzags between 205 and 285
        for (let i = 0; i < 4; i++) {
          ctx.lineTo(205 + (i + 1) * 20, Y + (i % 2 === 0 ? -16 : 16));
        }
        ctx.lineTo(295, Y);
        ctx.lineTo(320, Y); // Connects to right socket (X=320)
        ctx.stroke();

        ctx.font = 'italic 26px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('L1', 110, Y - 24);
        ctx.fillText('L2', 250, Y - 24);
      } else {
        // Output row: straight line from left socket (X=40) to right socket (X=320)
        ctx.beginPath();
        ctx.moveTo(40, Y);
        ctx.lineTo(320, Y);
        ctx.stroke();

        ctx.font = 'italic 30px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('Im', 180, Y - 20);
      }

      ctx.textAlign = 'left';
      ctx.font = 'bold 36px "Microsoft YaHei", sans-serif';
      if (secondary) {
        ctx.fillText(primary, 410, Y - 2);
        ctx.fillStyle = '#5b6469';
        ctx.font = '24px "Microsoft YaHei", sans-serif';
        ctx.fillText(secondary, 410, Y + 36);
      } else {
        ctx.fillText(primary, 410, Y + 12);
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(0.46, 0.07),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
      );
      label.rotation.x = -Math.PI / 2;
      label.position.set(-0.37, 0.0815, z);
      hallGroup.add(label);
    }

    makeTerminalLabel('螺线管', '', -0.12, 'solenoid');
    makeTerminalLabel('亥姆霍兹线圈', '共轴线圈', -0.025, 'helmholtz');
    makeTerminalLabel('励磁电流输出', '', 0.07, 'output');

    const hallTerminalPorts = new Map();
    const terminalGroups = [
      {
        key: 'solenoid', role: 'hall_terminal_solenoid',
        sockets: [
          ['sol_black', -0.58, -0.12, lab.rubberBlack, 0x171717],
          ['sol_red', -0.44, -0.12, lab.rubberRed, 0xd72d2d],
        ],
      },
      {
        key: 'helmholtz', role: 'hall_terminal_helmholtz',
        sockets: [
          ['hh_black', -0.58, -0.025, lab.rubberBlack, 0x171717],
          ['hh_fixed', -0.51, -0.025, lab.rubberRed, 0xd72d2d],
          ['hh_red', -0.44, -0.025, lab.rubberRed, 0xd72d2d],
        ],
      },
      {
        key: 'output', role: 'hall_terminal_output',
        sockets: [
          ['out_black', -0.58, 0.07, lab.rubberBlack, 0x171717],
          ['out_red', -0.44, 0.07, lab.rubberRed, 0xd72d2d],
        ],
      },
    ];
    terminalGroups.forEach(({ key, role, sockets }) => {
      sockets.forEach(([portId, x, z, material, wireColor]) => {
        const post = bindingPost(x, 0.084, z, material, role, portId, wireColor);
        post.userData.terminalGroup = key;
        hallGroup.add(post);
        hallTerminalPorts.set(portId, post);
      });
    });

    const hallWireLayer = new THREE.Group();
    hallGroup.add(hallWireLayer);
    const hallWirePreviewGeometry = new THREE.BufferGeometry();
    hallWirePreviewGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(32 * 3), 3));
    const hallWirePreviewMaterial = new THREE.LineBasicMaterial({ color: 0xd72d2d, transparent: true, opacity: 0.9 });
    const hallWirePreview = new THREE.Line(hallWirePreviewGeometry, hallWirePreviewMaterial);
    hallWirePreview.visible = false;
    hallWirePreview.frustumCulled = false;
    hallGroup.add(hallWirePreview);
    const hallWireRay = new THREE.Raycaster();
    const hallWirePlane = new THREE.Plane();
    const hallWireWorldPoint = new THREE.Vector3();
    const hallWirePlanePoint = new THREE.Vector3();
    const hallWirePlaneNormal = new THREE.Vector3();
    let hallWireSignature = '';

    const terminalAnchor = (portId) => {
      const post = hallTerminalPorts.get(portId);
      return post ? post.position.clone().add(new THREE.Vector3(0, 0.07, 0)) : null;
    };

    // AR aim is reconstructed from a camera-space fingertip, so it can miss a
    // small mesh even when the rendered pinch cursor appears to touch it.  Use
    // the nearest terminal to the aim ray as a semantic fallback.  This is
    // exposed to both hand and desktop resolvers; callers choose their own
    // tolerance so mouse picking stays tighter than hand tracking when needed.
    const hallTerminalProbeWorld = new THREE.Vector3();
    const getHallTerminalTarget = (raycaster, options = {}) => {
      const ray = raycaster?.ray;
      if (!ray) return null;
      // Hand aiming needs a forgiving target because the reconstructed fingertip
      // is not pixel accurate.  Desktop mouse aiming uses the same semantic
      // fallback, but with a slightly wider radius so the very small sockets can
      // still be grabbed reliably at normal bench distance.
      const maxAimDistance = Number.isFinite(options.maxDistance)
        ? Math.max(0, options.maxDistance)
        : 0.06;
      hallGroup.updateMatrixWorld(true);
      let best = null;
      let bestScore = Infinity;
      hallTerminalPorts.forEach((post, portId) => {
        const localAnchor = terminalAnchor(portId);
        if (!localAnchor) return;
        hallGroup.localToWorld(hallTerminalProbeWorld.copy(localAnchor));
        const toPoint = hallTerminalProbeWorld.clone().sub(ray.origin);
        const along = toPoint.dot(ray.direction);
        if (!(along > 0)) return;
        const distance = ray.distanceToPoint(hallTerminalProbeWorld);
        // About 4–6 cm at the bench depth: forgiving for hand tracking while
        // still separating the two closely spaced terminal columns.
        if (distance > maxAimDistance) return;
        const score = distance + along * 1e-4;
        if (score < bestScore) {
          bestScore = score;
          best = {
            target: post,
            hit: { object: post, distance: along },
          };
        }
      });
      return best;
    };

    const makeCableCurve = (from, to) => {
      const span = from.distanceTo(to);
      const lift = THREE.MathUtils.clamp(0.055 + span * 0.22, 0.07, 0.18);
      const controlA = from.clone().add(new THREE.Vector3(0, lift, 0));
      const controlB = to.clone().add(new THREE.Vector3(0, lift, 0));
      return new THREE.CubicBezierCurve3(from, controlA, controlB, to);
    };

    const setHallWires = (wires = []) => {
      const signature = JSON.stringify(wires);
      if (signature === hallWireSignature) return;
      hallWireSignature = signature;
      while (hallWireLayer.children.length) {
        const wire = hallWireLayer.children.pop();
        wire.geometry?.dispose?.();
        wire.material?.dispose?.();
      }
      hallTerminalPorts.forEach((post) => { post.userData.plug.visible = false; });
      wires.forEach((pair) => {
        const [from, to] = Array.isArray(pair) ? pair : [pair?.from, pair?.to];
        const start = terminalAnchor(from);
        const end = terminalAnchor(to);
        if (!start || !end || from === to) return;
        const sourcePost = hallTerminalPorts.get(from);
        const targetPost = hallTerminalPorts.get(to);
        const wireColor = (String(from).includes('black') || String(to).includes('black'))
          ? 0x171717
          : (sourcePost?.userData.wireColor ?? targetPost?.userData.wireColor ?? 0xd72d2d);
        const cable = new THREE.Mesh(
          new THREE.TubeGeometry(makeCableCurve(start, end), 36, 0.006, 8, false),
          new THREE.MeshStandardMaterial({
            color: wireColor,
            roughness: 0.68,
            metalness: 0.02,
          }),
        );
        cable.castShadow = true;
        hallWireLayer.add(cable);
        hallTerminalPorts.get(from).userData.plug.visible = true;
        hallTerminalPorts.get(to).userData.plug.visible = true;
      });
    };

    const startHallWirePreview = (portId) => {
      const post = hallTerminalPorts.get(portId);
      if (!post) return;
      hallWirePreviewMaterial.color.setHex(post.userData.wireColor ?? 0xd72d2d);
      hallWirePreview.visible = true;
    };

    const updateHallWirePreview = (fromPortId, aimSource, hoverPortId = null) => {
      const start = terminalAnchor(fromPortId);
      if (!start || !aimSource) return null;
      let snappedPortId = hoverPortId && hoverPortId !== fromPortId ? hoverPortId : null;
      let end = snappedPortId ? terminalAnchor(snappedPortId) : null;
      if (!end) {
        hallGroup.updateMatrixWorld(true);
        // AR supplies the fingertip ray for every drag frame.  Falling back to
        // the screen-centre camera ray made an unsnapped wire preview bend
        // toward one fixed side, regardless of where the hand moved.
        if (aimSource?.ray) {
          hallWireRay.ray.copy(aimSource.ray);
        } else if (aimSource?.isCamera) {
          hallWireRay.setFromCamera(new THREE.Vector2(0, 0), aimSource);
        }
        hallWirePlanePoint.set(0, 0.1, 0);
        hallGroup.localToWorld(hallWirePlanePoint);
        hallWirePlaneNormal.set(0, 1, 0).transformDirection(hallGroup.matrixWorld);
        hallWirePlane.setFromNormalAndCoplanarPoint(hallWirePlaneNormal, hallWirePlanePoint);
        if (hallWireRay.ray.intersectPlane(hallWirePlane, hallWireWorldPoint)) {
          end = hallWireWorldPoint.clone();
          hallGroup.worldToLocal(end);
        }
      }
      if (!end) end = start.clone();
      if (!snappedPortId) {
        let nearestDistance = 0.048;
        hallTerminalPorts.forEach((post, portId) => {
          if (portId === fromPortId) return;
          const anchor = terminalAnchor(portId);
          const distance = Math.hypot(anchor.x - end.x, anchor.z - end.z);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            snappedPortId = portId;
          }
        });
        if (snappedPortId) end = terminalAnchor(snappedPortId);
      }
      hallTerminalPorts.forEach((post, portId) => {
        post.scale.setScalar(portId === snappedPortId ? 1.18 : 1);
      });
      const curve = makeCableCurve(start, end);
      const attr = hallWirePreviewGeometry.attributes.position;
      for (let i = 0; i < 32; i++) {
        const point = curve.getPoint(i / 31);
        attr.setXYZ(i, point.x, point.y, point.z);
      }
      attr.needsUpdate = true;
      hallWirePreviewGeometry.computeBoundingSphere();
      hallWirePreview.visible = true;
      return snappedPortId;
    };

    const cancelHallWirePreview = () => {
      hallWirePreview.visible = false;
      hallTerminalPorts.forEach((post) => { post.scale.setScalar(1); });
    };
    const titleCanvas = document.createElement('canvas');
    titleCanvas.width = 640; titleCanvas.height = 96;
    const titleCtx = titleCanvas.getContext('2d');
    titleCtx.fillStyle = '#d6d8da'; titleCtx.fillRect(0, 0, 640, 96);
    titleCtx.fillStyle = '#dc2626'; titleCtx.font = 'bold 44px "Microsoft YaHei", sans-serif'; titleCtx.textAlign = 'center';
    titleCtx.fillText('HCC-2型  霍尔效应测磁仪', 320, 62);
    const titleTex = new THREE.CanvasTexture(titleCanvas); titleTex.colorSpace = THREE.SRGBColorSpace;
    const titlePlate = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.072), new THREE.MeshStandardMaterial({ map: titleTex }));
    titlePlate.rotation.x = -Math.PI / 2;
    titlePlate.position.set(0.18, 0.081, 0.07);
    hallGroup.add(titlePlate);

    // Magnetic field-line tracing follows the source Experiment3D implementation:
    // numerically integrate the axial/radial field of circular current loops.
    // Keep one textbook-style meridian slice instead of duplicating it around
    // the axis; this makes the field readable without a 3D starburst of lines.
    const helmholtzFieldLines = new THREE.Group();
    const solenoidFieldLines = new THREE.Group();
    helmholtzFieldLines.visible = false;
    solenoidFieldLines.visible = false;
    hallGroup.add(helmholtzFieldLines, solenoidFieldLines);

    const hallFieldMaterials = new Set();
    const hallFieldFlow = { direction: 1, speed: 0 };
    let hallFieldViewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    let hallFieldViewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
    let helmholtzFieldSignature = '';
    let solenoidFieldBuilt = false;
    let hallFieldPrewarmStarted = false;

    function getLoopField2D(x, radial, centreX, radius) {
      let bx = 0;
      let br = 0;
      const samples = 32;
      const dTheta = (Math.PI * 2) / samples;
      for (let i = 0; i < samples; i++) {
        const cosTheta = Math.cos(i * dTheta);
        const dx = x - centreX;
        const distanceSq = dx * dx + radial * radial + radius * radius
          - 2 * radius * radial * cosTheta;
        const distancePow = Math.pow(Math.max(distanceSq, 1e-7), 1.5);
        bx += ((radius * radius - radius * radial * cosTheta) / distancePow) * dTheta;
        br += ((radius * cosTheta * dx) / distancePow) * dTheta;
      }
      return { bx, br };
    }

    function traceAxisymmetricField(fieldAt, startX, startRadial, bounds, step, maxSteps) {
      const walk = (sign, includeStart) => {
        const points = [];
        let x = startX;
        let radial = startRadial;
        for (let i = 0; i < maxSteps; i++) {
          if (includeStart || i > 0) points.push({ x, radial });
          const { bx, br } = fieldAt(x, radial);
          const magnitude = Math.hypot(bx, br);
          if (!Number.isFinite(magnitude) || magnitude < 1e-8) break;
          x += sign * (bx / magnitude) * step;
          radial += sign * (br / magnitude) * step;
          if (x < bounds.minX || x > bounds.maxX
            || radial < bounds.minRadial || radial > bounds.maxRadial) break;
        }
        return points;
      };
      return [
        ...walk(-1, false).reverse(),
        ...walk(1, true),
      ];
    }

    function clearHallFieldGroup(group) {
      while (group.children.length) {
        const line = group.children.pop();
        if (line.material) hallFieldMaterials.delete(line.material);
        line.geometry?.dispose?.();
        line.material?.dispose?.();
      }
    }

    function addFlowingFieldLine(group, traced, axisY, axisZ, mirror = false) {
      if (traced.length < 6) return;
      const draw = (sign) => {
        const positions = [];
        traced.forEach(({ x, radial }) => {
          const y = axisY + sign * radial;
          if (y >= 0.08) {
            positions.push(x, y, axisZ);
          }
        });
        if (positions.length < 6) return;
        const geometry = new LineGeometry();
        geometry.setPositions(positions);
        const material = new LineMaterial({
          // Bright cyan reads clearly on the light lab background.
          color: 0x38bdf8,
          transparent: true,
          opacity: 0,
          // Crisp 6.0px screen-space line with distance scaling
          linewidth: 6.0,
          worldUnits: false,
          dashed: true,
          dashScale: 1,
          dashSize: 0.05,
          gapSize: 0.02,
          resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
          depthTest: true,
          depthWrite: false,
          toneMapped: false,
          alphaToCoverage: true,
        });
        const line = new Line2(geometry, material);
        line.computeLineDistances();
        line.frustumCulled = false;
        line.renderOrder = 25;
        line.raycast = () => {};
        group.add(line);
        hallFieldMaterials.add(material);
      };
      draw(1);
      if (mirror) draw(-1);
    }

    function rebuildHelmholtzFieldLines(coilMode = 'both') {
      const leftCentre = hallHelm.position.x + hallLeftCoil.position.x;
      const rightCentre = hallHelm.position.x + hallRightCoil.position.x;
      const signature = `${coilMode}:${leftCentre.toFixed(3)}:${rightCentre.toFixed(3)}`;
      if (signature === helmholtzFieldSignature) return;
      helmholtzFieldSignature = signature;
      clearHallFieldGroup(helmholtzFieldLines);

      const radius = 0.116;
      if (coilMode === 'fixed') {
        // 固定单线圈模式（仅左侧固定线圈通电）
        const fieldAt = (x, radial) => getLoopField2D(x, radial, leftCentre, radius);
        const bounds = { minX: leftCentre - 0.42, maxX: leftCentre + 0.42, minRadial: 0, maxRadial: 0.22 };
        [0, 0.025, 0.05, 0.075, 0.1].forEach((radial) => {
          const traced = traceAxisymmetricField(fieldAt, leftCentre, radial, bounds, 0.006, 380);
          addFlowingFieldLine(helmholtzFieldLines, traced, 0.28, -0.02, radial > 0);
        });
        [0.12, 0.15].forEach((radial) => {
          const tracedLeft = traceAxisymmetricField(fieldAt, leftCentre, radial, bounds, 0.006, 280);
          addFlowingFieldLine(helmholtzFieldLines, tracedLeft, 0.28, -0.02, true);
        });
      } else if (coilMode === 'moving') {
        // 移动单线圈模式（仅右侧移动线圈通电）
        const fieldAt = (x, radial) => getLoopField2D(x, radial, rightCentre, radius);
        const bounds = { minX: rightCentre - 0.42, maxX: rightCentre + 0.42, minRadial: 0, maxRadial: 0.22 };
        [0, 0.025, 0.05, 0.075, 0.1].forEach((radial) => {
          const traced = traceAxisymmetricField(fieldAt, rightCentre, radial, bounds, 0.006, 380);
          addFlowingFieldLine(helmholtzFieldLines, traced, 0.28, -0.02, radial > 0);
        });
        [0.12, 0.15].forEach((radial) => {
          const tracedRight = traceAxisymmetricField(fieldAt, rightCentre, radial, bounds, 0.006, 280);
          addFlowingFieldLine(helmholtzFieldLines, tracedRight, 0.28, -0.02, true);
        });
      } else {
        // 亥姆霍兹双线圈模式（两线圈同向通电）
        const fieldAt = (x, radial) => {
          const left = getLoopField2D(x, radial, leftCentre, radius);
          const right = getLoopField2D(x, radial, rightCentre, radius);
          return { bx: left.bx + right.bx, br: left.br + right.br };
        };
        const bounds = { minX: -0.38, maxX: 0.34, minRadial: 0, maxRadial: 0.22 };
        const centreX = (leftCentre + rightCentre) / 2;

        // 密集轴向线圈流
        [0, 0.025, 0.05, 0.075, 0.1].forEach((radial) => {
          const traced = traceAxisymmetricField(fieldAt, centreX, radial, bounds, 0.006, 420);
          addFlowingFieldLine(helmholtzFieldLines, traced, 0.28, -0.02, radial > 0);
        });

        // 左右两线圈各自的回流闭合回路
        [0.12, 0.15].forEach((radial) => {
          const tracedLeft = traceAxisymmetricField(fieldAt, leftCentre, radial, bounds, 0.006, 300);
          addFlowingFieldLine(helmholtzFieldLines, tracedLeft, 0.28, -0.02, true);

          const tracedRight = traceAxisymmetricField(fieldAt, rightCentre, radial, bounds, 0.006, 300);
          addFlowingFieldLine(helmholtzFieldLines, tracedRight, 0.28, -0.02, true);
        });
      }
    }

    function buildSolenoidFieldLines() {
      if (solenoidFieldBuilt) return;
      solenoidFieldBuilt = true;
      const loopCentres = [];
      for (let x = -0.5; x <= 0.5001; x += 0.04) loopCentres.push(x);
      const fieldAt = (x, radial) => {
        let bx = 0;
        let br = 0;
        loopCentres.forEach((centreX) => {
          const field = getLoopField2D(x, radial, centreX, 0.063);
          bx += field.bx;
          br += field.br;
        });
        return { bx, br };
      };
      // 放宽至左右 -0.66 到 0.66，使两端的发散喇叭口能够充分舒展展开，同时防止超长远场发散
      const bounds = { minX: -0.66, maxX: 0.66, minRadial: 0, maxRadial: 0.20 };
      // Denser on-axis samples: parallel tubes inside, flare at the mouths.
      [0, 0.012, 0.024, 0.036, 0.048, 0.058].forEach((radial) => {
        const traced = traceAxisymmetricField(fieldAt, 0, radial, bounds, 0.006, 440);
        addFlowingFieldLine(solenoidFieldLines, traced, 0.245, -0.24, radial > 0);
      });
    }

    animators.push((time) => {
      // Only animate field dashes while Hall group is the live mode.
      if (!hallGroup.visible) return;
      if (hallFieldViewportWidth !== window.innerWidth
        || hallFieldViewportHeight !== window.innerHeight) {
        hallFieldViewportWidth = window.innerWidth;
        hallFieldViewportHeight = window.innerHeight;
        hallFieldMaterials.forEach((material) => {
          material.resolution.set(hallFieldViewportWidth, hallFieldViewportHeight);
        });
      }
      // Camera distance attenuation: scale linewidth down as camera backs away
      // so lines remain slender and proportionate at any distance.
      const camDist = camera ? camera.position.distanceTo(hallGroup.position) : 1.2;
      const baseDist = 1.2;
      const distScale = Math.min(1.0, baseDist / Math.max(0.3, camDist));
      const dynamicLinewidth = 6.0 * distScale;

      const offset = -time * hallFieldFlow.speed * hallFieldFlow.direction;
      hallFieldMaterials.forEach((material) => {
        material.linewidth = dynamicLinewidth;
        material.dashOffset = offset;
      });
    });

    // Faraday induction apparatus ported from the standalone source.  The
    // controller keeps physical coordinates; this adapter applies only the
    // tabletop visual scale and offset.
    function createFaradayEquipment() {
      const root = new THREE.Group();
      root.name = 'faraday-induction-apparatus';
      root.visible = false;
      root.position.set(0, 0.0, 0.02);
      const S = 0.12;
      const OFFSET_X = -0.48;
      const ROD_LEN = 4;
      const X_END = 0.25;
      const X_MAX = 8;
      const RAIL_Z = ROD_LEN / 2;
      const Y = 0.08;
      const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.78, roughness: 0.28 });
      const endMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.72, roughness: 0.34 });
      const copperMat = new THREE.MeshStandardMaterial({
        color: 0xc47a3a, metalness: 0.88, roughness: 0.26, emissive: 0x4a2208, emissiveIntensity: 0.16,
      });
      const fieldGroup = new THREE.Group();
      const circuitGroup = new THREE.Group();
      const currentGroup = new THREE.Group();
      root.add(fieldGroup, circuitGroup, currentGroup);

      const makeRail = (z) => {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * S, 0.08 * S, (X_MAX - 0.2) * S, 14), railMat);
        mesh.rotation.z = Math.PI / 2;
        mesh.position.set(OFFSET_X + (0.2 + (X_MAX - 0.2) / 2) * S, Y * S, z * S);
        mesh.castShadow = true;
        mesh.raycast = () => {};
        return mesh;
      };
      circuitGroup.add(makeRail(RAIL_Z), makeRail(-RAIL_Z));

      const end = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * S, 0.09 * S, ROD_LEN * S, 14), endMat);
      end.rotation.x = Math.PI / 2;
      end.position.set(OFFSET_X + X_END * S, Y * S, 0);
      end.raycast = () => {};
      circuitGroup.add(end);

      const areaMat = new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
      const areaMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, ROD_LEN), areaMat);
      areaMesh.rotation.x = -Math.PI / 2;
      areaMesh.position.y = 0.001;
      areaMesh.raycast = () => {};
      circuitGroup.add(areaMesh);

      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * S, 0.12 * S, ROD_LEN * S, 20), copperMat);
      rod.rotation.x = Math.PI / 2;
      rod.castShadow = true;
      // Make the visible conductor itself grabable. The old interaction lived
      // only on a very thin invisible proxy, which was effectively a one-pixel
      // target after the tabletop scale was applied on iPad.
      rod.userData.interactive = true;
      rod.userData.role = 'faraday_rod';
      circuitGroup.add(rod);
      // Finger/hand tracking needs a forgiving grab volume around the rod.
      // It remains narrow along the rail direction so neighbouring controls
      // are not stolen, but is deliberately wider/taller than the geometry.
      const hit = new THREE.Mesh(
        new THREE.BoxGeometry(0.72 * S, 1.0 * S, ROD_LEN * S + 0.14),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hit.userData.interactive = true;
      hit.userData.role = 'faraday_rod';
      circuitGroup.add(hit);

      const fieldBounds = { x0: 0, x1: X_MAX + 1, z0: -RAIL_Z - 1, z1: RAIL_Z + 1, y0: -2.8, y1: 2.8 };
      // Single mid-plane. Fixed lattice indices; spacing = continuous f(|B|).
      // Arrows glide toward/away from center — no floor(nx) jumps. Length fixed forever.
      // Whole shaft+head stays ABOVE the rail/area plane so downward (B<0) tips are not buried in the table.
      const FIELD_LEN = 1.02 * S;
      const FIELD_HEAD_LEN = 0.32 * S;
      const FIELD_HEAD_W = 0.18 * S;
      const FIELD_SHAFT_R = 0.024 * S;
      // Vertical center of each arrow (local y). Origin shifts with sign so the body is centered here.
      const FIELD_MID_Y = Y * S + 0.008 + FIELD_LEN * 0.5;
      const FIELD_SPACING_SPARSE = 1.8;
      const FIELD_SPACING_DENSE = 0.85;
      const FIELD_X0 = 0.6;
      const FIELD_X1 = 7.8;
      const FIELD_Z0 = -1.65;
      const FIELD_Z1 = 1.65;
      const FIELD_CX = (FIELD_X0 + FIELD_X1) * 0.5;
      const FIELD_CZ = (FIELD_Z0 + FIELD_Z1) * 0.5;
      // Lattice sized so densest spacing exactly fills the draw box.
      const FIELD_NX = Math.max(2, Math.round((FIELD_X1 - FIELD_X0) / FIELD_SPACING_DENSE) + 1);
      const FIELD_NZ = Math.max(2, Math.round((FIELD_Z1 - FIELD_Z0) / FIELD_SPACING_DENSE) + 1);
      const FIELD_HALF_IX = (FIELD_NX - 1) * 0.5;
      const FIELD_HALF_IZ = (FIELD_NZ - 1) * 0.5;
      const FIELD_EDGE_FADE = 0.45;
      const FIELD_POOL = FIELD_NX * FIELD_NZ;
      let fieldShowKey = '';
      let fieldLastB = NaN;
      let fieldLastSign = 0;
      const fieldArrows = [];
      const fieldDir = new THREE.Vector3(0, 1, 0);
      const fieldArrowBatch = createInstancedArrowField({
        capacity: FIELD_POOL,
        length: FIELD_LEN,
        headLength: FIELD_HEAD_LEN,
        headWidth: FIELD_HEAD_W,
        shaftRadius: FIELD_SHAFT_R,
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        renderOrder: 26,
        name: 'faraday-field-arrows',
      });
      fieldGroup.add(fieldArrowBatch.group);
      function clearFieldMeshes() {
        fieldArrowBatch.setCount(0);
        fieldArrowBatch.commit();
        fieldShowKey = '';
        fieldLastB = NaN;
        fieldLastSign = 0;
      }
      function ensureFieldAssets(color, sign = 1) {
        if (fieldArrows.length >= FIELD_POOL) return;
        fieldDir.set(0, sign, 0);
        // Fixed (ix,iz) pool — densest fill; layout only moves roots / fades edges.
        for (let ix = 0; ix < FIELD_NX; ix += 1) {
          for (let iz = 0; iz < FIELD_NZ; iz += 1) {
            if (fieldArrows.length >= FIELD_POOL) break;
            fieldArrows.push({ ix, iz, lastSign: sign });
          }
        }
      }
      /** Soft mask: 1 inside the box, 0 outside, smooth band at the rim. */
      function fieldEdgeWeight(x, z) {
        const wx = THREE.MathUtils.smoothstep(x, FIELD_X0 - FIELD_EDGE_FADE, FIELD_X0)
          * (1 - THREE.MathUtils.smoothstep(x, FIELD_X1, FIELD_X1 + FIELD_EDGE_FADE));
        const wz = THREE.MathUtils.smoothstep(z, FIELD_Z0 - FIELD_EDGE_FADE, FIELD_Z0)
          * (1 - THREE.MathUtils.smoothstep(z, FIELD_Z1, FIELD_Z1 + FIELD_EDGE_FADE));
        return wx * wz;
      }
      function applyFieldLayout(B) {
        const b = Number(B || 0);
        const absB = Math.abs(b);
        const strength = THREE.MathUtils.clamp(absB / 3, 0, 1);
        const color = b >= 0 ? 0x38bdf8 : 0xf97316;
        const sign = b >= 0 ? 1 : -1;
        // Skip only true no-ops; every distinct B moves spacing continuously.
        if (sign === fieldLastSign && Number.isFinite(fieldLastB) && Math.abs(b - fieldLastB) < 1e-5) {
          return;
        }
        const signChanged = sign !== fieldLastSign;
        fieldLastB = b;
        fieldLastSign = sign;

        if (absB < 0.02) {
          fieldArrowBatch.setCount(0);
          fieldArrowBatch.commit();
          return;
        }

        // Linear spacing vs |B|: no tier / no floor(count) — lattice breathes continuously.
        const spacing = THREE.MathUtils.lerp(FIELD_SPACING_SPARSE, FIELD_SPACING_DENSE, strength);
        if (signChanged) fieldDir.set(0, sign, 0);
        const baseLineOp = THREE.MathUtils.lerp(0.65, 0.9, strength);
        const baseConeOp = THREE.MathUtils.lerp(0.75, 1.0, strength);

        for (let i = 0; i < fieldArrows.length; i += 1) {
          const arrow = fieldArrows[i];
          const ix = arrow.ix;
          const iz = arrow.iz;
          const x = FIELD_CX + (ix - FIELD_HALF_IX) * spacing;
          const z = FIELD_CZ + (iz - FIELD_HALF_IZ) * spacing;
          const edge = fieldEdgeWeight(x, z);
          if (edge <= 0.012) {
            fieldArrowBatch.setVisible(i, false);
            continue;
          }
          // Origin at the trailing end: for ↓B the root sits higher so the tip stays above the table.
          const originY = FIELD_MID_Y - sign * (FIELD_LEN * 0.5);
          const intensity = THREE.MathUtils.clamp((baseLineOp + baseConeOp) * 0.5 * edge, 0, 1);
          fieldArrowBatch.setArrow(i, {
            origin: [OFFSET_X + x * S, originY, z * S],
            direction: [0, sign, 0],
            color: new THREE.Color(color).multiplyScalar(0.55 + intensity * 0.45),
            visible: true,
          });
          arrow.lastSign = sign;
        }
        fieldArrowBatch.setCount(FIELD_POOL);
        fieldArrowBatch.commit();
      }
      function rebuildField(B, show) {
        if (!show) {
          if (fieldShowKey !== 'off') clearFieldMeshes();
          fieldShowKey = 'off';
          return;
        }
        if (fieldShowKey !== 'on') {
          fieldShowKey = 'on';
          fieldLastB = NaN;
          fieldLastSign = 0;
        }
        const b = Number(B || 0);
        ensureFieldAssets(b >= 0 ? 0x38bdf8 : 0xf97316, b >= 0 ? 1 : -1);
        applyFieldLayout(B);
      }

      // Induced-current flow: directional arrows along the closed circuit.
      // (Spheres were too small / slow / isotropic — hard to see direction.)
      // Fewer arrows → larger spacing along the closed circuit (reads clearer).
      const FLOW_COUNT = 14;
      const FLOW_ARROW_LEN = 0.58 * S;
      const FLOW_HEAD_LEN = 0.22 * S;
      const FLOW_HEAD_W = 0.14 * S;
      const FLOW_SHAFT_R = 0.018 * S;
      const flowArrows = [];
      const flowArrowBatch = createInstancedArrowField({
        capacity: FLOW_COUNT,
        length: FLOW_ARROW_LEN,
        headLength: FLOW_HEAD_LEN,
        headWidth: FLOW_HEAD_W,
        shaftRadius: FLOW_SHAFT_R,
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        renderOrder: 25,
        name: 'induced-current-arrows',
      });
      currentGroup.add(flowArrowBatch.group);
      const progress = [];
      let flowSense = 'none';
      let flowRodX = 4.5;
      const _loopPos = new THREE.Vector3();
      const _loopDir = new THREE.Vector3();
      const _loopPts = [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
      ];
      // Closed loop path slightly above rails/rod so arrows read clearly.
      const loopSample = (u, rodX, outPos, outDir) => {
        const y = (Y + 0.42) * S;
        const z0 = -RAIL_Z * S;
        const z1 = RAIL_Z * S;
        _loopPts[0].set(OFFSET_X + X_END * S, y, z0);
        _loopPts[1].set(OFFSET_X + rodX * S, y, z0);
        _loopPts[2].set(OFFSET_X + rodX * S, y, z1);
        _loopPts[3].set(OFFSET_X + X_END * S, y, z1);
        _loopPts[4].set(OFFSET_X + X_END * S, y, z0);
        let total = 0;
        const segLen = [];
        for (let i = 0; i < 4; i += 1) {
          const len = _loopPts[i].distanceTo(_loopPts[i + 1]);
          segLen.push(len);
          total += len;
        }
        let distance = (((u % 1) + 1) % 1) * Math.max(total, 1e-8);
        for (let i = 0; i < 4; i += 1) {
          const len = Math.max(segLen[i], 1e-8);
          if (distance <= len) {
            const t = distance / len;
            outPos.lerpVectors(_loopPts[i], _loopPts[i + 1], t);
            outDir.subVectors(_loopPts[i + 1], _loopPts[i]).normalize();
            return;
          }
          distance -= len;
        }
        outPos.copy(_loopPts[0]);
        outDir.subVectors(_loopPts[1], _loopPts[0]).normalize();
      };
      // Soft neon path outlining the circuit when current is flowing.
      const pathGeo = new THREE.BufferGeometry();
      pathGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
      const pathMat = new THREE.LineBasicMaterial({
        color: 0xf472b6,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const pathLine = new THREE.LineLoop(pathGeo, pathMat);
      pathLine.renderOrder = 24;
      pathLine.visible = false;
      pathLine.raycast = () => {};
      currentGroup.add(pathLine);
      function updatePathLine(rodX, color, active) {
        pathLine.visible = active;
        if (!active) {
          pathMat.opacity = 0;
          return;
        }
        const y = (Y + 0.38) * S;
        const z0 = -RAIL_Z * S;
        const z1 = RAIL_Z * S;
        const arr = pathGeo.attributes.position.array;
        const corners = [
          [OFFSET_X + X_END * S, y, z0],
          [OFFSET_X + rodX * S, y, z0],
          [OFFSET_X + rodX * S, y, z1],
          [OFFSET_X + X_END * S, y, z1],
        ];
        for (let i = 0; i < 4; i += 1) {
          arr[i * 3] = corners[i][0];
          arr[i * 3 + 1] = corners[i][1];
          arr[i * 3 + 2] = corners[i][2];
        }
        pathGeo.attributes.position.needsUpdate = true;
        pathGeo.computeBoundingSphere?.();
        pathMat.color.setHex(color);
        pathMat.opacity = 0.72;
      }
      function clearFlow() {
        flowArrowBatch.setCount(0);
        flowArrowBatch.commit();
        flowSense = 'none';
        pathLine.visible = false;
        pathMat.opacity = 0;
      }
      function buildFlow(sense, rodX) {
        if (sense === 'none') {
          if (flowSense !== 'none') clearFlow();
          return;
        }
        const senseChanged = sense !== flowSense;
        flowSense = sense;
        flowRodX = rodX;
        const color = sense === 'ccw' ? 0xa78bfa : 0xf472b6;
        if (senseChanged) flowArrowBatch.setColor(0, color);
        flowArrowBatch.setCount(FLOW_COUNT);
        updatePathLine(rodX, color, true);
      }

      // Pre-create pooled flow arrows once during initialization
      for (let i = 0; i < FLOW_COUNT; i += 1) {
        progress.push(i / FLOW_COUNT);
      }

      function makeFaradayLabelSprite() {
        if (typeof document === 'undefined') {
          return { sprite: new THREE.Group(), update: () => {}, flush: () => {} };
        }
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: true,
          depthWrite: false,
        }));
        sprite.scale.set(0.48, 0.12, 1);
        sprite.renderOrder = 30;
        sprite.raycast = () => {};

        let lastFormula = '';
        let lastColor = '';
        let lastUpdateAt = 0;
        let pendingFormula = '';
        let pendingColor = '';

        const render = (formula, textColor) => {
          lastFormula = formula;
          lastColor = textColor;
          pendingFormula = '';
          pendingColor = '';
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          drawMathFormula(ctx, formula, 256, 64, {
            fontSize: 48,
            color: textColor,
            align: 'center',
            textBaseline: 'middle',
            fontWeight: 'bold',
          });
          texture.needsUpdate = true;
        };

        const update = (formula, textColor = '#38bdf8', force = false) => {
          if (formula === lastFormula && textColor === lastColor) return;
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          if (!force && (now - lastUpdateAt < 40)) {
            pendingFormula = formula;
            pendingColor = textColor;
            return;
          }
          lastUpdateAt = now;
          render(formula, textColor);
        };

        const flush = () => {
          if (pendingFormula) render(pendingFormula, pendingColor);
        };

        return { sprite, update, flush };
      }

      const rodXLabel = makeFaradayLabelSprite();
      const areaFluxLabel = makeFaradayLabelSprite();
      circuitGroup.add(rodXLabel.sprite, areaFluxLabel.sprite);

      root.userData.update = (data, dt = 0) => {
        const x = THREE.MathUtils.clamp(Number(data?.x ?? 4.5), 1.2, 8);
        const B = Number(data?.B || 0);
        const flux = Number(data?.flux ?? (B * Math.max(x - X_END, 0) * ROD_LEN));
        rod.position.set(OFFSET_X + x * S, Y * S, 0);
        hit.position.set(OFFSET_X + x * S, Y * S, 0);
        const width = Math.max(x - X_END, 0.01);
        areaMesh.scale.set(width * S, S, 1);
        areaMesh.position.x = OFFSET_X + (X_END + width / 2) * S;
        areaMat.color.setHex(B >= 0 ? 0x60a5fa : 0xfb923c);
        areaMat.opacity = 0.12 + Math.min(Math.abs(flux) * 0.012, 0.18);

        // Update real-time 3D text labels (rod label directly above conductor, flux label floating at medium height)
        rodXLabel.sprite.position.set(OFFSET_X + x * S, (Y + 0.45) * S, 0);
        rodXLabel.update(`x = ${x.toFixed(2)} \\mathrm{m}`, '#f472b6');

        const areaCenterX = X_END + width / 2;
        areaFluxLabel.sprite.position.set(OFFSET_X + areaCenterX * S, (Y + 1.35) * S, 0);
        areaFluxLabel.update(`\\Phi_B = ${flux >= 0 ? '+' : ''}${flux.toFixed(2)} \\mathrm{Wb}`, B >= 0 ? '#38bdf8' : '#fb923c');
        if (dt === 0) {
          rodXLabel.flush();
          areaFluxLabel.flush();
        }
        rebuildField(Number(data?.B || 0), data?.showField !== false);
        buildFlow(data?.currentSense || 'none', x);
        if (flowSense !== 'none') {
          const dirSign = flowSense === 'ccw' ? 1 : -1;
          // ~0.55–0.95 rev/s so motion reads immediately while dragging/sliding B.
          const speed = 0.55 * Math.max(0.85, Math.min(1.7, 1 + Math.abs(Number(data?.B || 0)) * 0.08));
          flowRodX = x;
          const color = flowSense === 'ccw' ? 0xa78bfa : 0xf472b6;
          updatePathLine(flowRodX, color, true);
          const step = dirSign * speed * Math.max(0, Number(dt || 0));
          for (let i = 0; i < FLOW_COUNT; i += 1) {
            progress[i] = ((progress[i] + step) % 1 + 1) % 1;
            loopSample(progress[i], flowRodX, _loopPos, _loopDir);
            // Flow direction: reverse geometric tangent when current is CW.
            if (dirSign < 0) _loopDir.negate();
            const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(progress[i] * Math.PI * 2 * 3 + i * 0.7));
            flowArrowBatch.setArrow(i, {
              origin: _loopPos.clone().addScaledVector(_loopDir, -FLOW_ARROW_LEN * 0.35),
              direction: _loopDir,
              color: new THREE.Color(color).multiplyScalar(0.7 + 0.3 * pulse),
              visible: true,
            });
          }
          flowArrowBatch.commit();
        }
      };
      root.userData.hit = hit;
      return root;
    }
    const faradayGroup = createFaradayEquipment();
    const inducedEGroup = createInducedElectricFieldEquipment();

    // Physical recognition targets, matching the Faraday identify workflow.
    function addHallRecognitionTarget(host, role, size, outlinePos = [0, 0, 0]) {
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
    // Recognition hit volumes (tight enough to avoid whole-bench grabs).
    // Probe covers most of the sliding ruler so it is easy to aim; during
    // sequential identify, completed parts disable raycast and the curren
    // target gets priority so the long ruler does not permanently shadow the solenoid.
    const hallTargets = {
      hall_helmholtz: addHallRecognitionTarget(hallHelm, 'hall_helmholtz', [0.42, 0.3, 0.3], [0.04, 0.02, 0]),
      hall_solenoid: addHallRecognitionTarget(hallSolenoid, 'hall_solenoid', [0.95, 0.24, 0.22], [0, 0.0, 0]),
      // Full usable ruler length (rod visual is ~1.4 m starting near x=0)
      hall_probe: addHallRecognitionTarget(hallProbe, 'hall_probe', [1.32, 0.07, 0.08], [0.72, 0.02, 0]),
      // Keep this tight: a broad console proxy sits in front of the coils and
      // can otherwise swallow AR recognition rays meant for the other parts.
      hall_console: addHallRecognitionTarget(hallGroup, 'hall_console', [0.72, 0.11, 0.22], [0, 0.06, 0.18]),
    };
    const hallRecognitionRings = {
      hall_helmholtz: hallTargets.hall_helmholtz.outline,
      hall_solenoid: hallTargets.hall_solenoid.outline,
      hall_probe: hallTargets.hall_probe.outline,
      hall_console: hallTargets.hall_console.outline,
    };
    const hallRecognitionHits = {
      hall_helmholtz: hallTargets.hall_helmholtz.hit,
      hall_solenoid: hallTargets.hall_solenoid.hit,
      hall_probe: hallTargets.hall_probe.hit,
      hall_console: hallTargets.hall_console.hit,
    };
    const probeHitMesh = hallTargets.hall_probe.hit;
    const meshRaycast = THREE.Mesh.prototype.raycast;
    function setHallRecognitionMode(role, mode) {
      const ring = hallRecognitionRings[role];
      const hit = hallRecognitionHits[role];
      if (!ring) return;
      // Already-identified parts stop blocking rays so rear apparatus (e.g. solenoid
      // behind Helmholtz) can be selected from the front during sequential identify.
      if (hit) {
        if (mode === 'done' || (mode === 'off' && role === 'hall_console')) {
          hit.raycast = () => {};
          hit.userData.interactive = false;
        } else {
          hit.raycast = meshRaycast;
          hit.userData.interactive = true;
        }
      }
      if (mode === 'off') {
        ring.visible = false;
        ring.material.opacity = 0;
        return;
      }
      if (mode === 'done') {
        // No permanent outline on completed parts (also avoids visual clutter).
        ring.visible = false;
        ring.material.opacity = 0;
        return;
      }
      ring.visible = true;
      // hover=cyan (aimed correct target), locked=amber (aimed wrong order)
      const colors = {
        done: 0x4ade80,
        current: 0x38bdf8,
        hover: 0x67e8f9,
        locked: 0xfbbf24,
      };
      ring.material.color.setHex(colors[mode] || 0x38bdf8);
      ring.material.opacity = mode === 'locked' ? 0.7 : 1;
      ring.scale.setScalar(mode === 'hover' ? 1.04 : 1.025);
    }
    // The source carrier animation and the field explorations are separate
    // modes on this bench.  Mount them once before setMode() detaches the
    // inactive groups, otherwise opening the selector fails before a card can
    // start its experiment.
    const hallDemoGroup = createHallDemoEquipment({ tabletop: true });
    const gaussGroup = createGaussEquipment();
    const electricFieldGroup = createElectricFieldEquipment();
    g.add(hallGroup, hallDemoGroup, gaussGroup, electricFieldGroup, faradayGroup, inducedEGroup);

    g.userData.hallGroup = hallGroup;
    g.userData.hallDemoGroup = hallDemoGroup;
    g.userData.gaussGroup = gaussGroup;
    g.userData.electricFieldGroup = electricFieldGroup;
    g.userData.faradayGroup = faradayGroup;
    g.userData.inducedEGroup = inducedEGroup;
    g.userData.getRuntimeRoot = (mode) => ({
      hall: hallGroup,
      'hall-demo': hallDemoGroup,
      gauss: gaussGroup,
      'electric-field': electricFieldGroup,
      faraday: faradayGroup,
      'induced-e': inducedEGroup,
    })[mode] || g;

    /** Skip work when mode is unchanged (experiment re-entry). */
    let electroActiveMode = null;
    let electroModeGen = 0;
    const electroModeGroups = [
      ['hall', hallGroup],
      ['hall-demo', hallDemoGroup],
      ['gauss', gaussGroup],
      ['electric-field', electricFieldGroup],
      ['faraday', faradayGroup],
      ['induced-e', inducedEGroup],
    ];
    // Parent that owns mode groups. Inactive modes are DETACHED (O(1)), never
    // freeze-walked — tree walks were the first-open hitch root cause.
    const electroModeParent = hallGroup?.parent || g;
    /**
     * Attach/detach a mode group. O(1) scene-graph op — no matrix freeze walk.
     * Detached graphs are invisible to updateMatrixWorld and picking.
     */
    function mountElectroMode(group, on) {
      if (!group) return;
      if (on) {
        if (!group.parent) electroModeParent.add(group);
        group.visible = true;
      } else {
        group.visible = false;
        if (group.parent) group.parent.remove(group);
      }
    }
    g.userData.setMode = (mode) => {
      const next = mode || null;
      if (electroActiveMode === next) return;
      electroActiveMode = next;
      electroModeGen += 1;
      // Visibility + mount only — never freeze/unfreeze trees on open.
      for (const [id, group] of electroModeGroups) {
        mountElectroMode(group, next === id);
      }
      electricFieldGroup.userData.setInteractive?.(next === 'electric-field');
      inducedEGroup.userData.setInteractive?.(next === 'induced-e');
      // Raycast stays default Mesh.raycast. Detached groups are not pickable;
      // no O(n) rebind walk on first open.
    };
    g.userData.getActiveMode = () => electroActiveMode;
    // Boot with a clear tabletop; mount a mode only for a selected experiment.
    for (const [, group] of electroModeGroups) {
      mountElectroMode(group, false);
    }
    g.userData.setMode(null);
    g.userData.prewarmGpu = async (rendererArg = renderer, cameraArg = camera) => {
      const prepareScene = new THREE.Scene();
      const prepareCamera = cameraArg?.clone?.() || camera;
      const previousParent = g.parent;
      const previousVisible = g.visible;
      const modeState = electroModeGroups.map(([id, group]) => ({
        id,
        group,
        parent: group.parent,
        visible: group.visible,
      }));
      scene.traverse((object) => {
        if (!object.isLight) return;
        const light = object.clone();
        if (object.target?.isObject3D) light.target = object.target.clone();
        prepareScene.add(light);
      });
      try {
        previousParent?.remove?.(g);
        prepareScene.add(g);
        g.visible = true;
        modeState.forEach(({ group }) => mountElectroMode(group, true));
        // Start the expensive Hall field-line geometry in the background. Do
        // not await it here: compile/open timing must stay independent from
        // this visual cache, while the normal first interaction still gets a
        // synchronous fallback in updateHall() if it races the idle task.
        if (!hallFieldPrewarmStarted) {
          hallFieldPrewarmStarted = true;
          const warmHallField = () => {
            rebuildHelmholtzFieldLines();
            buildSolenoidFieldLines();
          };
          if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(warmHallField, { timeout: 1200 });
          } else {
            setTimeout(warmHallField, 0);
          }
        }
        g.updateWorldMatrix?.(true, true);
        if (typeof rendererArg?.compileAsync === 'function') {
          await rendererArg.compileAsync(prepareScene, prepareCamera);
        } else {
          rendererArg?.compile?.(prepareScene, prepareCamera);
        }
      } finally {
        modeState.forEach(({ group, parent, visible }) => {
          if (parent) parent.add(group);
          else group.parent?.remove?.(group);
          group.visible = visible;
        });
        prepareScene.remove(g);
        if (previousParent && g.parent !== previousParent) previousParent.add(g);
        g.visible = previousVisible;
      }
    };
    g.userData.updateHallDemo = (d, dt) => hallDemoGroup.userData.update?.(d, dt);
    g.userData.setHallDemoHostParticlesOwned = (owned) => {
      hallDemoGroup.userData.setHostParticlesOwned?.(owned);
    };
    g.userData.applyHallDemoHostParticles = (packed, stride) => {
      hallDemoGroup.userData.applyHostParticles?.(packed, stride);
    };
    g.userData.updateGauss = (d, dt) => gaussGroup.userData.update?.(d, dt);
    g.userData.updateElectricField = (d, dt) => electricFieldGroup.userData.update?.(d, dt);
    g.userData.updateFaraday = (d, dt) => faradayGroup.userData.update?.(d, dt);
    g.userData.updateInducedElectric = (d, dt) => inducedEGroup.userData.update?.(d, dt);

    g.userData.updateHall = (d) => {
      if (!d) return;
      const targetSolenoid = d.target === 'solenoid';
      if (probeHitMesh) {
        if (targetSolenoid) {
          // 长螺线管模式下适度放大探头拾取盒，方便在管内选中，同时避免向后过度膨胀遮挡全息屏幕
          probeHitMesh.scale.set(1, 1.8, 1.2);
        } else {
          probeHitMesh.scale.set(1, 1, 1);
        }
      }
      // Both devices remain present; only the probe changes measurement axis.
      hallProbe.position.z = targetSolenoid ? -0.24 : -0.02;
      hallProbe.position.y = targetSolenoid ? 0.245 : 0.28;
      // Source model maps the full −0.25…0.25 m range to ±1.0 world units.
      const rawProbe = Number(d.probePos || 0);
      const probeM = Math.abs(rawProbe) > 0.5 ? rawProbe / 100 : rawProbe;
      hallProbe.position.x = THREE.MathUtils.clamp(probeM / 0.25, -1, 1) * 1.0;
      const rawCoil = Number(d.rightCoilPos ?? 0.05);
      const coilM = Math.abs(rawCoil) > 0.5 ? rawCoil / 100 : rawCoil;
      hallRightCoil.position.x = -0.02
        + THREE.MathUtils.clamp((coilM - 0.02) / 0.135, 0, 1) * 0.34;
      setHallSolenoidTurns(d.turns);
      const energy = d.wiring?.energized
        ? THREE.MathUtils.clamp(Number(d.Im || 0), 0, 1)
        : 0;
      const coilMode = d.wiring?.coilMode || 'both';
      const leftActive = energy > 0 && !targetSolenoid && (coilMode === 'both' || coilMode === 'fixed');
      const rightActive = energy > 0 && !targetSolenoid && (coilMode === 'both' || coilMode === 'moving');
      hallLeftCopper.emissiveIntensity = leftActive ? (0.12 + energy * 0.58) : 0.08;
      hallRightCopper.emissiveIntensity = rightActive ? (0.12 + energy * 0.58) : 0.08;
      solWindMat.emissiveIntensity = (targetSolenoid && energy > 0) ? (0.08 + energy * 0.5) : 0.08;
      const fieldVisible = energy > 0.01;
      if (fieldVisible) {
        if (targetSolenoid) buildSolenoidFieldLines();
        else rebuildHelmholtzFieldLines(coilMode);
      }
      helmholtzFieldLines.visible = fieldVisible && !targetSolenoid;
      solenoidFieldLines.visible = fieldVisible && targetSolenoid;
      const turnGain = targetSolenoid
        ? THREE.MathUtils.clamp(Number(d.turns || 100) / 100, 0.2, 1.8)
        : 1;
      // Keep a readable floor opacity once the coil is energized so lines
      // never look like faint hairlines against the bright lab backdrop.
      const fieldOpacity = fieldVisible
        ? Math.min(1, 0.55 + energy * 1.15 * turnGain)
        : 0;
      const fieldColor = (d.direction || 1) > 0 ? 0x38bdf8 : 0xf472b6;
      hallFieldFlow.direction = (d.direction || 1) > 0 ? 1 : -1;
      hallFieldFlow.speed = fieldVisible ? 0.2 + energy * 0.32 : 0;
      hallFieldMaterials.forEach((material) => {
        material.opacity = fieldOpacity;
        material.color.setHex(fieldColor);
      });
      const rawIs = Number(d.Is || 0);
      const isA = rawIs > 0.05 ? rawIs / 1000 : rawIs;
      const rawVh = Number(d.vh || 0);
      const vhV = Math.abs(rawVh) > 0.05 ? rawVh / 1000 : rawVh;
      readoutDefs[0].paint(Number(d.Im || 0).toFixed(3));
      readoutDefs[1].paint(isA.toFixed(3));
      readoutDefs[2].paint((vhV * 1000).toFixed(2));
      hallKnobs[0].rotation.y = -Math.PI * 0.75 + Number(d.Im || 0) * Math.PI * 1.5;
      hallKnobs[1].rotation.y = -Math.PI * 0.75 + (isA / 0.010) * Math.PI * 1.5;
      setHallWires(d.wires || []);
    };
    g.userData.startHallWirePreview = startHallWirePreview;
    g.userData.updateHallWirePreview = updateHallWirePreview;
    g.userData.cancelHallWirePreview = cancelHallWirePreview;
    g.userData.getHallTerminalTarget = getHallTerminalTarget;
    g.userData.setHallPartState = setHallRecognitionMode;
    g.userData.clearHallIdentifyVisuals = () => {
      // After identify: keep probe/coil grab volumes, but disable the console-wide
      // recognition box so it cannot swallow Im/Is/zero knobs and terminals.
      Object.keys(hallRecognitionHits).forEach((role) => {
        setHallRecognitionMode(role, 'off');
        const hit = hallRecognitionHits[role];
        if (hit && role === 'hall_console') {
          hit.raycast = () => {};
          hit.userData.interactive = false;
        }
      });
    };
    // helpers for experiment handlers / rail picking
    const _ray = new THREE.Raycaster();
    const _railOrigin = new THREE.Vector3();
    const _railDir = new THREE.Vector3();
    const _railEnd = new THREE.Vector3();
    const _camOrigin = new THREE.Vector3();
    const _camDir = new THREE.Vector3();
    const _w = new THREE.Vector3();
    const _u = new THREE.Vector3();
    const _v = new THREE.Vector3();
    /**
     * Identify selection ring only (outline around equipment — no full-body glow).
     * mode: 'off' | 'hover' | 'done'
     */
    function makeSelectOutline(sx, sy, sz) {
      const box = new THREE.BoxGeometry(sx, sy, sz);
      const edges = new THREE.EdgesGeometry(box);
      const geometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
      box.dispose();
      edges.dispose();
      const mat = new LineMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0,
        linewidth: 4,
        worldUnits: false,
        resolution: new THREE.Vector2(
          typeof window !== 'undefined' ? window.innerWidth : 1280,
          typeof window !== 'undefined' ? window.innerHeight : 720,
        ),
        depthTest: true,
        toneMapped: false,
      });
      const outline = new LineSegments2(geometry, mat);
      outline.computeLineDistances();
      outline.visible = false;
      outline.userData.isSelectRing = true;
      outline.raycast = () => {}; // never block picks
      return outline;
    }

    g.userData.getHallProbePos = (cam, target = 'helmholtz') => {
      if (!cam) return null;
      const y = target === 'solenoid' ? 0.245 : 0.28;
      const z = target === 'solenoid' ? -0.24 : -0.02;
      _railOrigin.set(-0.27, y, z);
      _railEnd.set(0.27, y, z);
      hallGroup.localToWorld(_railOrigin);
      hallGroup.localToWorld(_railEnd);
      _railDir.subVectors(_railEnd, _railOrigin);
      _ray.setFromCamera(new THREE.Vector2(0, 0), cam);
      _camOrigin.copy(_ray.ray.origin);
      _camDir.copy(_ray.ray.direction).normalize();
      _u.copy(_railDir);
      _v.copy(_camDir);
      _w.subVectors(_railOrigin, _camOrigin);
      const a = _u.dot(_u);
      const b = _u.dot(_v);
      const c = _v.dot(_v);
      const d0 = _u.dot(_w);
      const e0 = _v.dot(_w);
      const denom = a * c - b * b;
      let s = Math.abs(denom) < 1e-10 ? -d0 / a : (b * e0 - c * d0) / denom;
      s = THREE.MathUtils.clamp(s, 0, 1);
      return -25 + s * 50;
    };

    return g;
  }

  // —— Precision analysis station (balance + display) ——

  const root = new THREE.Group();
  root.name = 'electro-station';
  // Slightly toward table center / back of sitting edge so multi-row desk
  // sliders on z≈3.13 don't sit under the Faraday / Hall apparatus.
  const hallBench = makeHallSetup();
  hallBench.position.set(-4.15, 0.905, 2.42);
  root.add(hallBench);

  const equipment = {
    getHallProbePos: (cam, target) => hallBench.userData.getHallProbePos?.(cam, target) ?? null,
    setMode: (mode) => hallBench.userData.setMode?.(mode),
    getRuntimeRoot: (mode) => hallBench.userData.getRuntimeRoot?.(mode) || hallBench,
    prewarmGpu: (...args) => hallBench.userData.prewarmGpu?.(...args),
    /** Active Station Runtime: clear the tabletop while the station is idle. */
    showcase: () => hallBench.userData.setMode?.(null),
    shutdown: () => hallBench.userData.setMode?.(null),
    suspend: () => hallBench.userData.setMode?.(null),
    resume: () => { /* mode restored by experiment applyVisualDefaults */ },
    updateHall: (data) => hallBench.userData.updateHall?.(data),
    updateHallDemo: (data, dt) => hallBench.userData.updateHallDemo?.(data, dt),
    setHallDemoHostParticlesOwned: (owned) => hallBench.userData.setHallDemoHostParticlesOwned?.(owned),
    applyHallDemoHostParticles: (packed, stride) => hallBench.userData.applyHallDemoHostParticles?.(packed, stride),
    updateGauss: (data, dt) => hallBench.userData.updateGauss?.(data, dt),
    updateElectricField: (data, dt) => hallBench.userData.updateElectricField?.(data, dt),
    updateFaraday: (data, dt) => hallBench.userData.updateFaraday?.(data, dt),
    updateInducedElectric: (data, dt) => hallBench.userData.updateInducedElectric?.(data, dt),
    startHallWirePreview: (portId) => hallBench.userData.startHallWirePreview?.(portId),
    updateHallWirePreview: (fromPortId, aimSource, hoverPortId) => hallBench.userData.updateHallWirePreview?.(fromPortId, aimSource, hoverPortId),
    cancelHallWirePreview: () => hallBench.userData.cancelHallWirePreview?.(),
    setHallPartState: (part, mode) => hallBench.userData.setHallPartState?.(part, mode),
    clearHallIdentifyVisuals: () => hallBench.userData.clearHallIdentifyVisuals?.(),
    getCamera: () => camera,
    getRoot: () => root,
    root,
    get activeMode() { return hallBench.userData.getActiveMode?.() || null; },
    mouseDrag: { holdLMB: false, movementX: 0, movementY: 0, shiftKey: false },
  };
  return {
    root,
    equipment,
    animators,
    // Intent/open path owns compileAsync + 1×1 present; no boot prewarm map.
    refs: { hallBench },
  };
}
