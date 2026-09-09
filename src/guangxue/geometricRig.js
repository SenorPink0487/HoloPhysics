/**
 * Geometric optics bench rig — faithful port of guangxue main.ts apparatus + rays.
 *
 * Critical: host attaches this group with a uniform scale. Ray tracing must run in
 * world space (mesh.matrixWorld includes scale), then segments convert back to
 * rig-local space for Line/Beam meshes parented under the rig.
 */
import * as THREE from 'three';
import {
  cauchyIOR,
  spectrumWavelengths,
  traceRay,
  wavelengthToRGB,
} from './opticsCore.js';
import { createGeometry, isMirrorShape } from './shapes.js';
import {
  createDeskLamp,
  createLabAccessories,
  createOpticalBench,
  createPrismTable,
  createRayBox,
  createScreen,
  createSlitHolder,
  GEO_POS,
} from './labBench.js';

const POS = GEO_POS;

function disposeObject3D(obj) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments) {
      child.geometry?.dispose();
      const m = child.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    }
  });
}

function clearGroup(g) {
  while (g.children.length) {
    const c = g.children[0];
    g.remove(c);
    disposeObject3D(c);
  }
}

function moveChildren(from, to) {
  while (from.children.length) {
    to.add(from.children[0]);
  }
}

/**
 * Create a complete geometric optics rig in source coordinates.
 * @param {{ renderer?: THREE.WebGLRenderer, getEnvironment?: () => THREE.Texture|null }} [opts]
 */
export function createGeometricOpticsRig(opts = {}) {
  const root = new THREE.Group();
  root.name = 'geometric-optics-rig';

  // Host already provides room floor/walls/fog. Do NOT add source createLabFloor()
  // (huge plane + back wall) — those read as stray faces on the station table.
  root.add(createOpticalBench());
  root.add(createLabAccessories());
  root.add(createDeskLamp());

  // Host sun/hemi & envMap provide complete station lighting — no global ambient injection.

  const rayBox = createRayBox();
  rayBox.position.x = POS.source;
  root.add(rayBox);

  const slitHolder = createSlitHolder();
  slitHolder.position.x = POS.slit;
  root.add(slitHolder);

  const prismTable = createPrismTable();
  prismTable.position.x = POS.sample;
  root.add(prismTable);

  const screenRig = createScreen();
  screenRig.position.x = POS.screen;
  root.add(screenRig);

  // Source glow at ray-box slit (follows beam height). Short range — not a room light.
  const sourceGlow = new THREE.PointLight(0xffc070, 0.55, 3.5, 2);
  sourceGlow.castShadow = false;
  root.add(sourceGlow);

  // Soft aura at aperture (source emissive slit is small; host FOV is wide)
  const apertureHalo = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffb040,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  apertureHalo.rotation.y = Math.PI / 2;
  apertureHalo.position.set(POS.source + 0.58, -0.55, 0);
  apertureHalo.renderOrder = 3;
  root.add(apertureHalo);

  /**
   * CRITICAL GPU NOTE (Three r170):
   * MeshPhysicalMaterial.transmission forces an extra full-scene refraction
   * pass every frame while any transmitting mesh is visible. That alone made
   * geometric optics unusable and left residual cost if the island stayed in
   * the graph. We keep a glass *look* with transparent + envMap + clearcoat
   * and NO transmission pass.
   */
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xc8e8ff,
    metalness: 0.05,
    roughness: 0.08,
    transmission: 0,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    envMapIntensity: 1.35,
    clearcoat: 0.85,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
  });

  const mirrorMat = new THREE.MeshStandardMaterial({
    color: 0xd8e0e8,
    metalness: 0.95,
    roughness: 0.12,
    envMapIntensity: 1.35,
    side: THREE.DoubleSide,
  });

  const mirrorBackMat = new THREE.MeshStandardMaterial({
    color: 0x3a4048,
    roughness: 0.55,
    metalness: 0.25,
  });

  const opticGroup = new THREE.Group();
  opticGroup.position.set(POS.sample, -0.42, 0);
  root.add(opticGroup);

  const shapeGeometryCache = new Map();
  const initialOpticGeometry = createGeometry('mirror');
  shapeGeometryCache.set('mirror', initialOpticGeometry);
  let opticMesh = new THREE.Mesh(initialOpticGeometry, mirrorMat);
  // Shadows on transmission samples double the fill cost; optics are self-lit.
  opticMesh.castShadow = false;
  opticMesh.receiveShadow = false;
  opticMesh.userData.interactive = true;
  opticMesh.userData.role = 'geo_optic';
  opticGroup.add(opticMesh);

  let mirrorBack = null;
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xa8b8c4,
    transparent: true,
    opacity: 0.4,
  });
  let edgeLines = null;

  // Normal marker at first hit (pedagogy — dashed line along surface normal)
  const normalGroup = new THREE.Group();
  normalGroup.name = 'geo-normal';
  root.add(normalGroup);

  const rayGroup = new THREE.Group();
  rayGroup.name = 'geo-rays';
  root.add(rayGroup);
  const spotGroup = new THREE.Group();
  spotGroup.name = 'geo-spots';
  root.add(spotGroup);

  const params = {
    angle: 35,
    height: 0,
    rayCount: 1,
    ior: 1.52,
    dispersion: false,
    dispersionStrength: 0.6,
    shape: 'mirror',
    rotate: 0,
    showReflect: true,
    mode: 'mirror',
  };

  let lastIncident = 35;
  let lastRefract = null;
  let lastReflect = 35;
  let lastSignature = '';
  let envTexture = null;
  /** When true, mesh/params changed but ray segments are not rebuilt yet. */
  let raysPending = false;
  // Boot rehearsal visits every default optical experiment. Keep the completed
  // visual trees resident so the real first open only reparents already-uploaded
  // objects instead of recreating and re-uploading hundreds of GPU resources.
  // The bound also prevents live parameter edits from growing VRAM indefinitely.
  const MAX_RAY_VISUAL_CACHE = 8;
  const rayVisualCache = new Map();

  function paramsSignature() {
    return [
      params.shape, params.angle, params.height, params.rayCount, params.ior,
      params.dispersion, params.dispersionStrength, params.rotate, params.showReflect, params.mode,
    ].join('|');
  }

  function disposeVisualEntry(entry) {
    if (!entry) return;
    clearGroup(entry.rays);
    clearGroup(entry.spots);
    clearGroup(entry.normals);
  }

  function parkCompletedRays() {
    if (rayBuild || raysPending || !lastSignature) return false;
    const hasVisuals = rayGroup.children.length
      || spotGroup.children.length
      || normalGroup.children.length;
    if (!hasVisuals) return false;

    const previous = rayVisualCache.get(lastSignature);
    if (previous) disposeVisualEntry(previous);
    const entry = {
      rays: new THREE.Group(),
      spots: new THREE.Group(),
      normals: new THREE.Group(),
      theta1: lastIncident,
      thetaRefract: lastRefract,
      thetaReflect: lastReflect,
    };
    moveChildren(rayGroup, entry.rays);
    moveChildren(spotGroup, entry.spots);
    moveChildren(normalGroup, entry.normals);
    rayVisualCache.delete(lastSignature);
    rayVisualCache.set(lastSignature, entry);

    while (rayVisualCache.size > MAX_RAY_VISUAL_CACHE) {
      const oldestKey = rayVisualCache.keys().next().value;
      const oldest = rayVisualCache.get(oldestKey);
      rayVisualCache.delete(oldestKey);
      disposeVisualEntry(oldest);
    }
    return true;
  }

  function restoreParkedRays(signature) {
    const entry = rayVisualCache.get(signature);
    if (!entry) return false;
    rayVisualCache.delete(signature);
    recycleChildrenToPool(rayGroup);
    recycleChildrenToPool(spotGroup);
    recycleChildrenToPool(normalGroup);
    moveChildren(entry.rays, rayGroup);
    moveChildren(entry.spots, spotGroup);
    moveChildren(entry.normals, normalGroup);
    lastIncident = entry.theta1;
    lastRefract = entry.thetaRefract;
    lastReflect = entry.thetaReflect;
    lastSignature = signature;
    rayBuild = null;
    raysPending = false;
    return true;
  }

  function applyEnvironment(tex) {
    envTexture = tex || null;
    if (envTexture) {
      glassMat.envMap = envTexture;
      mirrorMat.envMap = envTexture;
      glassMat.needsUpdate = true;
      mirrorMat.needsUpdate = true;
    }
  }

  // Optional env from host at construction
  if (typeof opts.getEnvironment === 'function') {
    applyEnvironment(opts.getEnvironment());
  }

  function rebuildEdges() {
    if (edgeLines) {
      opticGroup.remove(edgeLines);
      edgeLines.geometry.dispose();
      edgeLines = null;
    }
    const threshold = isMirrorShape(params.shape) ? 1 : 20;
    edgeLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(opticMesh.geometry, threshold),
      edgeMat,
    );
    opticGroup.add(edgeLines);
  }

  function updateMirrorBacking(kind) {
    if (mirrorBack) {
      opticGroup.remove(mirrorBack);
      mirrorBack.geometry.dispose();
      mirrorBack = null;
    }
    if (kind === 'mirror') {
      mirrorBack = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.42, 1.22), mirrorBackMat);
      mirrorBack.position.x = 0.06;
      mirrorBack.castShadow = false;
      opticGroup.add(mirrorBack);
    }
  }

  function applyMaterialForShape(kind) {
    if (isMirrorShape(kind)) {
      opticMesh.material = mirrorMat;
      params.mode = 'mirror';
      edgeMat.color.set(0xc0c8d0);
      edgeMat.opacity = 0.55;
    } else {
      opticMesh.material = glassMat;
      if (params.mode === 'mirror') params.mode = 'dielectric';
      edgeMat.color.set(0xa8b8c4);
      edgeMat.opacity = 0.4;
      glassMat.thickness = kind === 'sphere' ? 1.3 : kind === 'block' ? 1.5 : 1.4;
    }
    if (envTexture) {
      glassMat.envMap = envTexture;
      mirrorMat.envMap = envTexture;
    }
    updateMirrorBacking(kind);
  }

  function setShape(kind) {
    params.shape = kind;
    let geometry = shapeGeometryCache.get(kind);
    if (!geometry) {
      geometry = createGeometry(kind);
      shapeGeometryCache.set(kind, geometry);
    }
    opticMesh.geometry = geometry;
    opticMesh.rotation.set(0, 0, 0);
    if (isMirrorShape(kind)) params.mode = 'mirror';
    else if (params.mode === 'mirror') params.mode = 'dielectric';
    applyMaterialForShape(kind);
    rebuildEdges();
  }

  // ── High performance visual object pools & shared unit geometries ──
  const _UNIT_Z = new THREE.Vector3(0, 0, 1);
  const _dirNorm = new THREE.Vector3();
  const UNIT_CYL_5 = new THREE.CylinderGeometry(1, 0.92, 1, 5, 1, true);
  UNIT_CYL_5.translate(0, 0.5, 0);
  UNIT_CYL_5.rotateX(Math.PI / 2);
  const UNIT_CYL_6 = new THREE.CylinderGeometry(1, 0.92, 1, 6, 1, true);
  UNIT_CYL_6.translate(0, 0.5, 0);
  UNIT_CYL_6.rotateX(Math.PI / 2);
  const UNIT_SPHERE_SPOT = new THREE.SphereGeometry(1, 14, 14);
  const UNIT_CIRCLE_GLOW = new THREE.CircleGeometry(1, 20);

  const visualPool = {
    lines: [],
    beams: [],
    spots: [],
    glows: [],
    blooms: [],
    normals: [],
    tips: [],
  };

  function recycleChildrenToPool(g) {
    while (g.children.length) {
      const c = g.children.pop();
      const kind = c.userData.poolKind;
      if (kind && visualPool[kind]) {
        visualPool[kind].push(c);
      } else {
        disposeObject3D(c);
      }
    }
  }

  /** Source line core with buffer reuse */
  function makeRayLine(seg) {
    const isMirror = params.mode === 'mirror';
    const opacity = (
      (seg.kind === 'reflected'
        ? isMirror ? 0.98 : 0.38
        : seg.kind === 'incident' ? 0.95 : 0.9) * seg.intensity
    );
    let line = visualPool.lines.pop();
    if (!line) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({
        color: seg.color,
        transparent: true,
        opacity: Math.min(1, opacity),
        depthWrite: false,
        toneMapped: false,
      });
      line = new THREE.Line(geom, mat);
      line.renderOrder = 4;
      line.userData.poolKind = 'lines';
    } else {
      line.material.color.copy(seg.color);
      line.material.opacity = Math.min(1, opacity);
    }
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, seg.start.x, seg.start.y, seg.start.z);
    pos.setXYZ(1, seg.end.x, seg.end.y, seg.end.z);
    pos.needsUpdate = true;
    return line;
  }

  function createTubeMesh(segs) {
    const geom = segs === 5 ? UNIT_CYL_5 : UNIT_CYL_6;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 3;
    mesh.frustumCulled = true;
    return mesh;
  }

  /** Source volumetric beam (+ optional soft shell when ray count is low) with pooling. */
  function makeBeamMesh(seg, radius, withShell = true) {
    const dir = new THREE.Vector3().subVectors(seg.end, seg.start);
    const len = dir.length();
    if (len < 1e-5) return null;

    _dirNorm.copy(dir).multiplyScalar(1 / len);
    const isMirror = params.mode === 'mirror';
    const baseOp = (
      (seg.kind === 'reflected'
        ? isMirror ? 0.42 : 0.14
        : seg.kind === 'incident' ? 0.32 : 0.36) * seg.intensity
    );

    let group = visualPool.beams.pop();
    if (!group) {
      group = new THREE.Group();
      group.userData.poolKind = 'beams';
      const coreTube = createTubeMesh(5);
      const shellTube = createTubeMesh(6);
      group.add(coreTube);
      group.add(shellTube);
      group.userData.core = coreTube;
      group.userData.shell = shellTube;
    }

    const core = group.userData.core;
    core.position.copy(seg.start);
    core.quaternion.setFromUnitVectors(_UNIT_Z, _dirNorm);
    core.scale.set(radius, radius, len);
    core.material.color.copy(seg.color);
    core.material.opacity = Math.min(1, baseOp);
    core.visible = true;

    const shell = group.userData.shell;
    if (withShell) {
      shell.position.copy(seg.start);
      shell.quaternion.setFromUnitVectors(_UNIT_Z, _dirNorm);
      shell.scale.set(radius * 2.0, radius * 2.0, len);
      shell.material.color.copy(seg.color);
      shell.material.opacity = Math.min(1, baseOp * 0.32);
      shell.visible = true;
    } else {
      shell.visible = false;
    }

    return group;
  }

  function getBeamDirectionLocal() {
    const a = (params.angle * Math.PI) / 180;
    return new THREE.Vector3(Math.cos(a), Math.sin(a), 0).normalize();
  }

  function getBeamOriginLocal() {
    return new THREE.Vector3(POS.source + 0.55, -0.55 + params.height, 0);
  }

  function clipSegmentToScreen(seg) {
    if (params.mode === 'mirror') return seg;
    const sx = POS.screen - 0.04;
    if (seg.start.x < sx && seg.end.x > sx) {
      const t = (sx - seg.start.x) / (seg.end.x - seg.start.x);
      const end = new THREE.Vector3().lerpVectors(seg.start, seg.end, t);
      return { ...seg, end };
    }
    if (seg.start.x >= sx) {
      return { ...seg, end: seg.start.clone() };
    }
    return seg;
  }

  function addScreenSpot(point, color, intensity) {
    const localY = point.y - (-0.25);
    const localZ = point.z;
    if (Math.abs(localZ) > 0.75 || Math.abs(localY) > 0.65) return;

    let spot = visualPool.spots.pop();
    if (!spot) {
      spot = new THREE.Mesh(
        UNIT_SPHERE_SPOT,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.65 + intensity * 0.35,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      spot.renderOrder = 5;
      spot.userData.poolKind = 'spots';
    } else {
      spot.material.color.copy(color);
      spot.material.opacity = 0.65 + intensity * 0.35;
    }
    spot.scale.setScalar(0.05 + intensity * 0.03);
    spot.position.set(POS.screen - 0.05, point.y, point.z);
    spotGroup.add(spot);

    let glow = visualPool.glows.pop();
    if (!glow) {
      glow = new THREE.Mesh(
        UNIT_CIRCLE_GLOW,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      glow.rotation.y = Math.PI / 2;
      glow.renderOrder = 4;
      glow.userData.poolKind = 'glows';
    } else {
      glow.material.color.copy(color);
      glow.material.opacity = 0.28;
    }
    glow.scale.setScalar(0.14 + intensity * 0.08);
    glow.position.set(POS.screen - 0.06, point.y, point.z);
    spotGroup.add(glow);

    // Secondary soft bloom disc
    let bloom = visualPool.blooms.pop();
    if (!bloom) {
      bloom = new THREE.Mesh(
        UNIT_CIRCLE_GLOW,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      bloom.rotation.y = Math.PI / 2;
      bloom.renderOrder = 3;
      bloom.userData.poolKind = 'blooms';
    } else {
      bloom.material.color.copy(color);
      bloom.material.opacity = 0.12;
    }
    bloom.scale.setScalar(0.28 + intensity * 0.1);
    bloom.position.set(POS.screen - 0.07, point.y, point.z);
    spotGroup.add(bloom);
  }

  function projectHitsOnScreen(segments) {
    const sx = POS.screen - 0.04;
    for (const seg of segments) {
      if (seg.kind === 'reflected') continue;
      if (seg.start.x < sx && seg.end.x >= sx) {
        const t = (sx - seg.start.x) / (seg.end.x - seg.start.x + 1e-9);
        const p = new THREE.Vector3().lerpVectors(seg.start, seg.end, t);
        addScreenSpot(p, seg.color, seg.intensity);
      } else if (Math.abs(seg.end.x - sx) < 0.15 && seg.end.x >= sx - 0.2) {
        addScreenSpot(seg.end, seg.color, seg.intensity);
      }
    }
  }

  function drawNormalAtFirstHit(worldHitPoint, worldNormal, invRoot) {
    recycleChildrenToPool(normalGroup);
    if (!worldHitPoint || !worldNormal) return;
    const p = worldHitPoint.clone().applyMatrix4(invRoot);
    const n = worldNormal.clone().transformDirection(invRoot).normalize();
    const len = 0.55;

    let line = visualPool.normals.pop();
    if (!line) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      line = new THREE.Line(
        geo,
        new THREE.LineDashedMaterial({
          color: 0x6a7280,
          dashSize: 0.06,
          gapSize: 0.04,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        }),
      );
      line.renderOrder = 6;
      line.userData.poolKind = 'normals';
    }
    const pos = line.geometry.attributes.position;
    const p0 = p.clone().addScaledVector(n, -len * 0.15);
    const p1 = p.clone().addScaledVector(n, len);
    pos.setXYZ(0, p0.x, p0.y, p0.z);
    pos.setXYZ(1, p1.x, p1.y, p1.z);
    pos.needsUpdate = true;
    line.computeLineDistances();
    normalGroup.add(line);

    // Small tip sphere
    let tip = visualPool.tips.pop();
    if (!tip) {
      tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x94a3b8, depthWrite: false }),
      );
      tip.userData.poolKind = 'tips';
    }
    tip.position.copy(p1);
    normalGroup.add(tip);
  }

  /**
   * Convert a world-space trace segment into rig-local coordinates.
   */
  function toLocalSeg(seg, invRoot) {
    return {
      ...seg,
      start: seg.start.clone().applyMatrix4(invRoot),
      end: seg.end.clone().applyMatrix4(invRoot),
      color: seg.color,
    };
  }

  /** Progressive ray build state (one beam per coop slice when possible). */
  let rayBuild = null;

  function consumeTraceResult(build, result, markDispersed = false) {
    const invRoot = build.invRoot;
    if (!build.firstHitPoint && result.segments?.length) {
      const inc = result.segments.find((s) => s.kind === 'incident');
      if (inc && result.firstIncidentAngle != null) {
        build.firstHitPoint = inc.end.clone();
        const refl = result.segments.find((s) => s.kind === 'reflected');
        if (refl) {
          const I = new THREE.Vector3().subVectors(inc.end, inc.start).normalize();
          const R = new THREE.Vector3().subVectors(refl.end, refl.start).normalize();
          build.firstHitNormal = new THREE.Vector3().subVectors(R, I).normalize();
          if (build.firstHitNormal.lengthSq() < 1e-6) build.firstHitNormal = null;
        }
      }
    }

    const multiBeam = build.count > 3;
    result.segments.forEach((segWorld) => {
      const local = toLocalSeg(segWorld, invRoot);
      if (markDispersed && segWorld.kind === 'refracted') local.kind = 'dispersed';
      const clipped = clipSegmentToScreen(local);
      if (clipped.start.distanceTo(clipped.end) < 1e-4) return;
      rayGroup.add(makeRayLine(clipped));
      // Skip volumetric tubes on weak reflected limbs when many beams already fill.
      if (multiBeam && clipped.kind === 'reflected' && clipped.intensity < 0.2) return;
      if (params.mode === 'mirror' || clipped.kind !== 'reflected') {
        const beam = makeBeamMesh(
          clipped,
          params.mode === 'mirror' ? 0.022 : 0.018,
          !multiBeam,
        );
        if (beam) rayGroup.add(beam);
      }
    });

    if (params.mode !== 'mirror') {
      const localSegs = result.segments.map((s) => toLocalSeg(s, invRoot));
      projectHitsOnScreen(localSegs);
    }
    if (build.reportIncident === null && result.firstIncidentAngle !== null) {
      build.reportIncident = result.firstIncidentAngle;
      build.reportRefract = result.firstRefractAngle;
      build.reportReflect = result.firstReflectAngle;
    }
  }

  function beginRayBuild() {
    recycleChildrenToPool(rayGroup);
    recycleChildrenToPool(spotGroup);
    recycleChildrenToPool(normalGroup);

    glassMat.ior = params.ior;
    opticGroup.rotation.y = (params.rotate * Math.PI) / 180;

    root.updateWorldMatrix(true, true);
    opticMesh.updateWorldMatrix(true, true);

    const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const originLocal = getBeamOriginLocal();
    const dirLocal = getBeamDirectionLocal();
    const worldDir = dirLocal.clone().transformDirection(root.matrixWorld).normalize();

    sourceGlow.position.set(POS.source + 0.55, -0.55 + params.height, 0);
    apertureHalo.position.set(POS.source + 0.58, -0.55 + params.height, 0);
    rayBox.position.y = params.height * 0.15;

    const showReflect = params.mode === 'mirror' ? true : params.showReflect;
    const useDispersion = params.dispersion && params.rayCount > 1 && params.mode !== 'mirror';
    const wavelengths = useDispersion ? spectrumWavelengths(params.rayCount) : null;
    const count = useDispersion
      ? wavelengths.length
      : Math.max(1, params.rayCount);

    rayBuild = {
      i: 0,
      count,
      useDispersion,
      wavelengths,
      invRoot,
      originLocal,
      dirLocal,
      worldDir,
      traceOpts: { showReflect, mode: params.mode },
      reportIncident: null,
      reportRefract: null,
      reportReflect: null,
      firstHitPoint: null,
      firstHitNormal: null,
    };
    raysPending = true;
  }

  function finalizeRayBuild(build) {
    if (build.firstHitPoint && build.firstHitNormal) {
      drawNormalAtFirstHit(build.firstHitPoint, build.firstHitNormal, build.invRoot);
    }
    let reportIncident = build.reportIncident;
    let reportRefract = build.reportRefract;
    let reportReflect = build.reportReflect;
    if (reportIncident === null) {
      reportIncident = params.angle;
      if (params.mode === 'mirror') {
        reportReflect = params.angle;
      } else {
        const s = (1 / params.ior) * Math.sin((params.angle * Math.PI) / 180);
        reportRefract = Math.abs(s) <= 1 ? (Math.asin(s) * 180) / Math.PI : null;
      }
    }
    lastIncident = reportIncident;
    lastRefract = reportRefract;
    lastReflect = reportReflect;
    rayBuild = null;
    raysPending = false;
  }

  /**
   * Trace a single pending beam. Returns true if more beams remain.
   * Used by frame-budget coop so camera frames can interleave.
   */
  function stepRayBuild() {
    if (!rayBuild) {
      if (!raysPending) return false;
      beginRayBuild();
    }
    const build = rayBuild;
    if (!build || build.i >= build.count) {
      if (build) finalizeRayBuild(build);
      return false;
    }

    const i = build.i;
    build.i += 1;

    if (build.useDispersion) {
      const nm = build.wavelengths[i];
      const t = build.count === 1 ? 0.5 : i / (build.count - 1);
      const offset = (t - 0.5) * 0.08;
      const oLocal = build.originLocal.clone().add(new THREE.Vector3(0, offset, 0));
      const oWorld = oLocal.applyMatrix4(root.matrixWorld);
      const n = cauchyIOR(params.ior, nm, params.dispersionStrength);
      const color = wavelengthToRGB(nm);
      const result = traceRay(oWorld, build.worldDir, opticMesh, n, color, build.traceOpts);
      consumeTraceResult(build, result, true);
    } else {
      const t = build.count === 1 ? 0.5 : i / (build.count - 1);
      const offset = (t - 0.5) * (params.mode === 'mirror' ? 0.28 : 0.35);
      const perpLocal = new THREE.Vector3(-build.dirLocal.y, build.dirLocal.x, 0).normalize();
      const oLocal = build.originLocal.clone().addScaledVector(perpLocal, offset);
      const oWorld = oLocal.applyMatrix4(root.matrixWorld);
      const color = params.mode === 'mirror'
        ? new THREE.Color(0x5eb0ff).lerp(new THREE.Color(0xffc878), t)
        : new THREE.Color(0xff9a45).lerp(new THREE.Color(0xffd070), t);
      const result = traceRay(oWorld, build.worldDir, opticMesh, params.ior, color, build.traceOpts);
      consumeTraceResult(build, result, false);
    }

    if (build.i >= build.count) {
      finalizeRayBuild(build);
      return false;
    }
    return true;
  }

  function updateRays() {
    beginRayBuild();
    while (stepRayBuild()) {
      /* sync full rebuild for live drag / non-switch path */
    }
  }

  /**
   * Apply optical sample + beam parameters.
   * @param {object} next
   * @param {{ force?: boolean, deferRays?: boolean, keepRays?: boolean }} [applyOpts]
   *   - force: rebuild rays even if signature unchanged
   *   - deferRays: update mesh/material now, schedule full trace for later (switch path)
   *   - keepRays: with deferRays, leave previous beams until rebuild (live drag)
   */
  function applyParams(next = {}, applyOpts = {}) {
    const force = !!(applyOpts.force || next.force);
    const deferRays = !!(applyOpts.deferRays || next.deferRays);
    const keepRays = !!(applyOpts.keepRays || next.keepRays);
    // Preserve the last complete visual before mutating params. During boot this
    // fills the default-signature cache; during use it makes returning instant.
    parkCompletedRays();
    const shapeChanged = next.shape != null && next.shape !== params.shape;
    if (next.angle != null) params.angle = Number(next.angle);
    if (next.height != null) params.height = Number(next.height);
    if (next.rayCount != null) params.rayCount = Math.max(1, Math.round(Number(next.rayCount)));
    if (next.ior != null) params.ior = Number(next.ior);
    if (next.dispersion != null) params.dispersion = !!next.dispersion;
    if (next.dispersionStrength != null) params.dispersionStrength = Number(next.dispersionStrength);
    if (next.rotate != null) params.rotate = Number(next.rotate);
    if (next.showReflect != null) params.showReflect = !!next.showReflect;
    if (next.mode != null && (next.mode === 'mirror' || next.mode === 'dielectric')) {
      params.mode = next.mode;
    }

    if (shapeChanged) {
      setShape(next.shape);
    } else if (next.mode != null || next.ior != null) {
      if (isMirrorShape(params.shape)) {
        params.mode = 'mirror';
        opticMesh.material = mirrorMat;
      } else {
        if (params.mode === 'mirror') params.mode = 'dielectric';
        opticMesh.material = glassMat;
        glassMat.ior = params.ior;
      }
    }

    const signature = paramsSignature();
    if (!force && restoreParkedRays(signature)) {
      return snapshot();
    }
    if (force && rayVisualCache.has(signature)) {
      disposeVisualEntry(rayVisualCache.get(signature));
      rayVisualCache.delete(signature);
    }

    if (!edgeLines) rebuildEdges();

    // Defer O(tris×rays) trace. Switch path clears stale beams; live drag keeps
    // them until beginRayBuild so the view does not flicker empty.
    if (deferRays && !force) {
      lastSignature = ''; // force a real rebuild when flush happens
      raysPending = true;
      rayBuild = null;
      if (!keepRays) {
        recycleChildrenToPool(rayGroup);
        recycleChildrenToPool(spotGroup);
        recycleChildrenToPool(normalGroup);
      }
      return snapshot();
    }

    lastSignature = signature;
    raysPending = false;
    updateRays();
    return snapshot();
  }

  /**
   * Flush a deferred ray rebuild.
   * Prefer stepRayBuild via scheduleCoop for switch path; this sync API
   * still builds all rays (live drag / tests).
   */
  function flushDeferredRays() {
    if (!raysPending && !rayBuild) return snapshot();
    const signature = paramsSignature();
    lastSignature = signature;
    if (!edgeLines) rebuildEdges();
    if (!rayBuild) beginRayBuild();
    while (stepRayBuild()) {
      /* complete remaining beams */
    }
    return snapshot();
  }

  /**
   * Drop a deferred rebuild without tracing. A completed visual is parked rather
   * than disposed so a boot-rehearsed experiment remains genuinely prewarmed.
   */
  function cancelDeferredRays() {
    if (!rayBuild && !raysPending && parkCompletedRays()) return;
    raysPending = false;
    rayBuild = null;
    lastSignature = '';
    clearRays();
  }

  function clearRays() {
    recycleChildrenToPool(rayGroup);
    recycleChildrenToPool(spotGroup);
    recycleChildrenToPool(normalGroup);
  }

  function snapshot() {
    return {
      angle: params.angle,
      height: params.height,
      rayCount: params.rayCount,
      ior: params.ior,
      dispersion: params.dispersion,
      dispersionStrength: params.dispersionStrength,
      shape: params.shape,
      rotate: params.rotate,
      showReflect: params.showReflect,
      mode: params.mode,
      theta1: lastIncident,
      theta2: params.mode === 'mirror' ? lastReflect : lastRefract,
      thetaReflect: lastReflect,
      thetaRefract: lastRefract,
    };
  }

  function setActive(active) {
    const on = !!active;
    root.visible = on;
    sourceGlow.visible = on;
    sourceGlow.intensity = on ? 0.55 : 0;
    amb.intensity = on ? 0.42 : 0;
    if (!on) {
      cancelDeferredRays();
    }
  }

  /** Strip shadows on the whole island (host room already shadows the table). */
  function disableIslandShadows() {
    root.traverse((obj) => {
      if (obj.isLight) {
        obj.castShadow = false;
      }
      if (obj.isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });
  }
  disableIslandShadows();

  function animate(t) {
    if (!root.visible) return;
    const slit = rayBox.userData.slit;
    if (slit && slit.material instanceof THREE.MeshStandardMaterial) {
      slit.material.emissiveIntensity = 1.2 + Math.sin(t * 3) * 0.22;
    }
    if (apertureHalo.material) {
      apertureHalo.material.opacity = 0.28 + Math.sin(t * 3) * 0.08;
    }
    // Subtle source glow pulse
    sourceGlow.intensity = 0.5 + Math.sin(t * 2.4) * 0.08;
  }

  // Initial sample (local only; world matrices correct once parented)
  rebuildEdges();
  updateMirrorBacking('mirror');
  // Defer first ray build until attached — call updateRays after host adds to scene
  // Still build once so idle showcase has content when scale/pos are set.
  try { updateRays(); } catch { /* not yet parented */ }

  root.userData.api = {
    applyParams,
    snapshot,
    updateRays,
    flushDeferredRays,
    stepRayBuild,
    cancelDeferredRays,
    clearRays,
    setShape,
    setActive,
    animate,
    applyEnvironment,
    get params() { return { ...params }; },
    get raysPending() { return raysPending || !!rayBuild; },
    get opticMesh() { return opticMesh; },
    get rayBox() { return rayBox; },
    get rayCacheSize() { return rayVisualCache.size; },
  };

  const parts = [
    { obj: rayBox, role: 'geo_source', size: [1.4, 1.2, 1.2], y: -0.55 },
    { obj: slitHolder, role: 'geo_slit', size: [0.9, 1.2, 1.0], y: -0.5 },
    { obj: prismTable, role: 'geo_sample', size: [1.8, 1.4, 1.6], y: -0.5 },
    { obj: screenRig, role: 'geo_screen', size: [1.2, 1.8, 1.8], y: -0.3 },
  ];
  for (const { obj, role, size, y } of parts) {
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.y = y;
    hit.userData.interactive = true;
    hit.userData.role = role;
    obj.add(hit);
  }

  return root;
}

/**
 * Host scale for ~14.5-unit source bench.
 * 0.19 ≈ 2.76 host units — leaves a sitting-edge strip for the desk param panel.
 */
export const GEO_HOST_SCALE = 0.19;
