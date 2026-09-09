import * as THREE from 'three';
import {
  inducedEDirection,
  inducedEMagnitude,
  inducedESense,
} from './electro.js';
import { formatPhysicsNumber, drawMathFormula } from '../physicsFormula.js';

const WORLD_PER_SOURCE = 0.13;
export const MAX_E_RINGS = 24;
const E_MARKERS_PER_RING = 8;

/**
 * 物理原理与动效设计：
 * 1. 内圈 (r < R)：
 *    - 柱体内部感生电场强度 E ∝ r，随半径向圆心减小而线性衰减至 E=0；
 *    - 场线的绝对空间坐标与候选条数在空间中是完全确定的（FIXED_INNER_RADII），
 *      改变磁场半径 R 时只改变展示的范围窗口（增大 R 则向外露出更多圈）；
 *    - 从圆心往外，场线间距严格递减（场强越来越强，场线越来越密）。
 * 2. 外圈 (r > R)：
 *    - 柱体外部感生电场强度 E ∝ 1/r，向外反比衰减，场线越来越稀疏（间距递增）；
 *    - 外圈不是预先固定死坐标的，而是根据分割圈 R 以及最靠近分割圈的内圈线动态生成；
 *    - 最靠近分割圈的那根外圈场线到分割圈的间距，与最靠近分割圈的那根内圈场线到分割圈的间距基本一致。
 */
export const FIXED_INNER_RADII = Object.freeze([
  0.38,
  0.83,  // Δ = 0.45
  1.19,  // Δ = 0.36
  1.48,  // Δ = 0.29
  1.72,  // Δ = 0.24
  1.92,  // Δ = 0.20
  2.10,  // Δ = 0.18
  2.26,  // Δ = 0.16
  2.41,  // Δ = 0.15
  2.55,  // Δ = 0.14
  2.68,  // Δ = 0.13
  2.80,  // Δ = 0.12
  2.91,  // Δ = 0.11
  3.02,  // Δ = 0.11
]);

export function computeInducedFieldRingRadii(regionR, rateD, Rdisk = 4.55) {
  const absRate = Math.abs(Number(rateD || 0));
  if (absRate < 0.02) return [];

  const safeR = Math.max(0.6, Math.min(3.2, Number(regionR || 2)));
  const margin = 0.06;

  // 1. 内圈 (r < R)：坐标固定确定，仅改变展示范围；增大 R 展现更多内圈线，间距向外递减
  const inRadii = FIXED_INNER_RADII.filter((r) => r <= safeR - margin);
  if (inRadii.length === 0 && FIXED_INNER_RADII[0] < safeR) {
    inRadii.push(FIXED_INNER_RADII[0]);
  }

  // 2. 外圈 (r > R)：随着分割圈 R 和最靠近分割圈的内圈线动态生成
  const lastIn = inRadii.length > 0 ? inRadii[inRadii.length - 1] : safeR * 0.5;
  const innerFirstGap = Math.max(0.06, safeR - lastIn);

  const outRadii = [];
  let currOut = safeR + innerFirstGap;
  let currStep = innerFirstGap;
  const stepRatio = 1.42;

  while (currOut <= Rdisk) {
    outRadii.push(Number(currOut.toFixed(4)));
    currStep = currStep * stepRatio;
    currOut += currStep;
  }

  return [...inRadii, ...outRadii];
}

/** Source-space R max (matches desk slider R max). Lattice covers densest fill of this disk. */
const B_R_MAX = 3.0;
/** Faraday-style lattice spacing in source units: sparse ↔ dense vs |B|. */
const B_SPACING_SPARSE = 1.45;
const B_SPACING_DENSE = 0.48;
const B_EDGE_FADE = 0.35;

/** Frameless two-line billboard: q and E only, above the probe charge. */
function createFloatingHudLabel({ worldScale = 1 } = {}) {
  if (typeof document === 'undefined') {
    const sprite = new THREE.Group();
    sprite.userData = {};
    return {
      sprite,
      setQE: (qText, eText, accent = '#fde68a', rText = null, fText = null) => {
        sprite.userData.hudKey = `${accent}|${qText}|${eText}|${rText || ''}|${fText || ''}`;
        sprite.userData.qText = qText;
        sprite.userData.eText = eText;
        sprite.userData.rText = rText;
        sprite.userData.fText = fText;
      },
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 280;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    opacity: 1,
  }));
  sprite.center.set(0.5, 0);
  const baseW = 0.40 * worldScale;
  const heightFor = (n) => (0.040 + 0.038 * Math.max(1, n)) * worldScale;
  sprite.scale.set(baseW, heightFor(2), 1);
  sprite.renderOrder = 24;
  sprite.raycast = () => {};
  let lastKey = '';

  function setQE(qText, eText, accent = '#fde68a', rText = null, fText = null) {
    const key = `${accent}|${qText}|${eText}|${rText || ''}|${fText || ''}`;
    if (key === lastKey) return;
    lastKey = key;
    sprite.userData.hudKey = key;
    sprite.userData.qText = qText;
    sprite.userData.eText = eText;
    sprite.userData.rText = rText;
    sprite.userData.fText = fText;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const drawLine = (text, y, size, color) => {
      if (!text) return;
      ctx.font = `bold ${size}px "Microsoft YaHei", sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeText(text, W / 2, y);
      ctx.fillStyle = color;
      ctx.fillText(text, W / 2, y);
    };

    const lines = [
      qText ? { text: qText, color: '#38bdf8', size: 32 } : null,
      rText ? { text: rText, color: '#cbd5e1', size: 32 } : null,
      { text: eText, color: '#f8fafc', size: 32 },
      fText ? { text: fText, color: '#cbd5e1', size: 32 } : null,
    ].filter(Boolean);

    sprite.scale.set(baseW, heightFor(lines.length), 1);
    const lineSpacing = 42;
    const centerY = H * 0.50;
    const startY = centerY - ((lines.length - 1) * lineSpacing) / 2;
    lines.forEach((line, i) => {
      const y = startY + i * lineSpacing;
      drawLine(line.text, y, line.size, line.color);
    });
    texture.needsUpdate = true;
  }

  return { sprite, setQE };
}

/**
 * Tabletop apparatus: cylindrical uniform-B region + concentric induced E rings.
 * Source coordinates (R, r, B) stay in the controller; this adapter only scales.
 */
export function createInducedElectricFieldEquipment() {
  const root = new THREE.Group();
  root.name = 'induced-electric-field-apparatus';
  root.visible = false;
  // Shift apparatus slightly to the left (-0.02m) to center naturally on the workbench while leaving clean clearance for the right-side control panel.
  root.position.set(-0.02, 0.0, 0.02);

  const S = WORLD_PER_SOURCE;
  const fieldGroup = new THREE.Group();
  const eGroup = new THREE.Group();
  const probeGroup = new THREE.Group();
  const labelGroup = new THREE.Group();
  root.add(fieldGroup, eGroup, probeGroup, labelGroup);
  const _tangentDir = new THREE.Vector3(1, 0, 0);

  // Dark, emissive measurement plane: floor disk.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.6 * S, 64),
    new THREE.MeshStandardMaterial({
      color: 0x0b1630,
      transparent: true,
      opacity: 0.78,
      metalness: 0.42,
      roughness: 0.38,
      emissive: 0x071426,
      emissiveIntensity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  floor.receiveShadow = true;
  fieldGroup.add(floor);

  // Physical rim: retains a clear usable-probe boundary at shallow angles.
  const workRim = new THREE.Mesh(
    new THREE.TorusGeometry(4.6 * S, 0.026 * S, 8, 96),
    new THREE.MeshStandardMaterial({
      color: 0x334e72,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.22,
      metalness: 0.64,
      roughness: 0.24,
    }),
  );
  workRim.rotation.x = Math.PI / 2;
  workRim.position.y = 0.008;
  fieldGroup.add(workRim);

  // Glass cylinder marking the uniform-B region boundary.
  const regionMat = new THREE.MeshPhysicalMaterial({
    color: 0x0ea5e9,
    transparent: true,
    opacity: 0.38,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
    roughness: 0.24,
    metalness: 0.16,
    emissive: 0x075985,
    emissiveIntensity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const region = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.8 * S, 48, 1, true), regionMat);
  region.position.y = 0.9 * S;
  fieldGroup.add(region);

  const regionCapMat = new THREE.MeshBasicMaterial({
    color: 0x0ea5e9,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const regionTop = new THREE.Mesh(new THREE.CircleGeometry(1, 48), regionCapMat);
  regionTop.rotation.x = -Math.PI / 2;
  regionTop.position.y = 1.8 * S;
  const regionBottom = regionTop.clone();
  regionBottom.position.y = 0.01;
  fieldGroup.add(regionTop, regionBottom);
  const regionRim = new THREE.Mesh(
    // Radius is scaled from source R below; use an unscaled tube width so the
    // rim remains legible instead of shrinking into a hairline at small R.
    new THREE.TorusGeometry(1, 0.024, 8, 64),
    new THREE.MeshStandardMaterial({
      color: 0x67e8f9,
      emissive: 0x0891b2,
      emissiveIntensity: 1.35,
      metalness: 0.36,
      roughness: 0.22,
    }),
  );
  regionRim.rotation.x = Math.PI / 2;
  regionRim.position.y = 0.14 * S;
  fieldGroup.add(regionRim);
  // No wireframe cage — the soft glass cylinder + B arrows already mark the region.

  // Vertical B arrows — Faraday-style lattice:
  //   · length fixed at create (never setLength)
  //   · |B| drives spacing (sparse↔dense) + opacity continuously
  //   · soft circular mask to the current R region
  //   · sign flips direction / color; origin shifts so tips stay above the plane
  const B_ARROW_LEN = 1.05 * S;
  const B_ARROW_HEAD_LEN = 0.28 * S;
  const B_ARROW_HEAD_W = 0.14 * S;
  const B_ARROW_MID_Y = 0.12 * S + B_ARROW_LEN * 0.5;
  const B_NX = Math.max(3, Math.round((2 * B_R_MAX) / B_SPACING_DENSE) + 1);
  const B_NZ = B_NX;
  const B_HALF_IX = (B_NX - 1) * 0.5;
  const B_HALF_IZ = (B_NZ - 1) * 0.5;
  const B_POOL = B_NX * B_NZ;
  const bDir = new THREE.Vector3(0, 1, 0);
  const bArrows = [];
  const bArrowGroup = new THREE.Group();
  fieldGroup.add(bArrowGroup);
  for (let ix = 0; ix < B_NX; ix += 1) {
    for (let iz = 0; iz < B_NZ; iz += 1) {
      const arrow = new THREE.ArrowHelper(
        bDir,
        new THREE.Vector3(0, B_ARROW_MID_Y - B_ARROW_LEN * 0.5, 0),
        B_ARROW_LEN,
        0x38bdf8,
        B_ARROW_HEAD_LEN,
        B_ARROW_HEAD_W,
      );
      arrow.userData.ix = ix;
      arrow.userData.iz = iz;
      arrow.line.material.transparent = true;
      arrow.line.material.depthWrite = false;
      arrow.line.material.depthTest = true;
      arrow.cone.material.transparent = true;
      arrow.cone.material.depthWrite = false;
      arrow.cone.material.depthTest = true;
      arrow.renderOrder = 25;
      arrow.line.renderOrder = 25;
      arrow.cone.renderOrder = 26;
      arrow.visible = false;
      bArrowGroup.add(arrow);
      bArrows.push(arrow);
    }
  }
  let bLastB = NaN;
  let bLastSign = 0;
  let bLastR = NaN;

  /** Soft disk mask: 1 inside R, 0 outside, smooth rim (source units). */
  function bEdgeWeight(x, z, regionR) {
    const r = Math.hypot(x, z);
    const outer = regionR + B_EDGE_FADE;
    if (r >= outer) return 0;
    if (r <= regionR) return 1;
    return 1 - THREE.MathUtils.smoothstep(r, regionR, outer);
  }

  function applyBFieldLayout(B, regionR) {
    const b = Number(B || 0);
    const absB = Math.abs(b);
    const strength = THREE.MathUtils.clamp(absB / 2.5, 0, 1);
    const color = b >= 0 ? 0x38bdf8 : 0xea580c;
    const sign = b >= 0 ? 1 : -1;
    // Skip true no-ops; any change in B or R must re-breathe the lattice.
    if (
      sign === bLastSign
      && Number.isFinite(bLastB)
      && Math.abs(b - bLastB) < 1e-5
      && Number.isFinite(bLastR)
      && Math.abs(regionR - bLastR) < 1e-5
    ) {
      return { color, strength };
    }
    bLastB = b;
    bLastSign = sign;
    bLastR = regionR;

    if (absB < 0.02) {
      for (let i = 0; i < bArrows.length; i += 1) bArrows[i].visible = false;
      return { color, strength };
    }

    // Linear spacing vs |B|: no tier / no floor(count) — lattice breathes continuously.
    const spacing = THREE.MathUtils.lerp(B_SPACING_SPARSE, B_SPACING_DENSE, strength);
    bDir.set(0, sign, 0);
    const baseLineOp = THREE.MathUtils.lerp(0.76, 0.98, strength);
    const baseConeOp = THREE.MathUtils.lerp(0.82, 1, strength);
    const originY = B_ARROW_MID_Y - sign * (B_ARROW_LEN * 0.5);

    for (let i = 0; i < bArrows.length; i += 1) {
      const arrow = bArrows[i];
      const ix = arrow.userData.ix;
      const iz = arrow.userData.iz;
      // Source-space lattice root; scale to world with S.
      const x = (ix - B_HALF_IX) * spacing;
      const z = (iz - B_HALF_IZ) * spacing;
      const edge = bEdgeWeight(x, z, regionR);
      if (edge <= 0.012) {
        arrow.visible = false;
        continue;
      }
      arrow.visible = true;
      arrow.position.set(x * S, originY, z * S);
      arrow.setDirection(bDir);
      // Length is created fixed — never call setLength.
      arrow.setColor(color);
      const lineOp = baseLineOp * edge;
      const coneOp = baseConeOp * edge;
      if (arrow.line?.material) {
        arrow.line.material.color?.setHex?.(color);
        arrow.line.material.opacity = lineOp;
      }
      if (arrow.cone?.material) {
        arrow.cone.material.color?.setHex?.(color);
        arrow.cone.material.opacity = coneOp;
      }
    }
    return { color, strength };
  }

  // Concentric E rings: each ring is a group (line + tangent markers) that spins as a unit.
  const eRings = [];
  const ringGeoCache = new Map();
  function ringGeometry(segments = 64) {
    if (!ringGeoCache.has(segments)) {
      const pts = [];
      for (let i = 0; i <= segments; i += 1) {
        const t = (i / segments) * Math.PI * 2;
        pts.push(Math.cos(t), 0, Math.sin(t));
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      ringGeoCache.set(segments, geo);
    }
    return ringGeoCache.get(segments);
  }

  for (let index = 0; index < MAX_E_RINGS; index += 1) {
    const ring = new THREE.Group();
    eGroup.add(ring);

    const mat = new THREE.LineBasicMaterial({
      color: 0xf472b6,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const line = new THREE.LineLoop(ringGeometry(72), mat);
    line.position.y = 0.12 * S;
    ring.add(line);

    // Tangent E markers — well-proportioned, crisp arrows.
    const E_ARROW_LEN = 0.36 * S;
    const E_ARROW_HEAD_LEN = 0.18 * S;
    const E_ARROW_HEAD_W = 0.10 * S;
    const markers = [];
    for (let k = 0; k < E_MARKERS_PER_RING; k += 1) {
      const phase = (k / E_MARKERS_PER_RING) * Math.PI * 2;
      const marker = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0.12 * S, 0),
        E_ARROW_LEN,
        0xf472b6,
        E_ARROW_HEAD_LEN,
        E_ARROW_HEAD_W,
      );
      marker.line.material.transparent = true;
      marker.line.material.depthWrite = false;
      marker.cone.material.transparent = true;
      marker.cone.material.depthWrite = false;
      marker.renderOrder = 25;
      marker.line.renderOrder = 25;
      marker.cone.renderOrder = 26;
      ring.add(marker);
      markers.push({ marker, phase });
    }
    eRings.push({ ring, line, mat, markers });
  }

  // Probe charge.
  const probe = new THREE.Group();
  const probeCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.105 * S, 20, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffd43b,
      emissive: 0xffb000,
      emissiveIntensity: 0.95,
      metalness: 0.2,
      roughness: 0.28,
    }),
  );
  probeCore.renderOrder = 28;
  probeCore.frustumCulled = false;

  const probeHalo = new THREE.Mesh(
    new THREE.SphereGeometry(0.20 * S, 14, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffd43b,
      transparent: true,
      opacity: 0.45,
      depthTest: true,
      depthWrite: false,
    }),
  );
  probeHalo.renderOrder = 27;
  probeHalo.frustumCulled = false;

  const probeHit = new THREE.Mesh(
    new THREE.SphereGeometry(0.38 * S, 14, 10),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  // Probe force arrow — fixed length; hide when |F|≈0 (same rule as Faraday tips).
  const FORCE_ARROW_LEN = 0.48 * S;
  const forceArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 0),
    FORCE_ARROW_LEN,
    0x4ade80,
    0.16 * S,
    0.09 * S,
  );
  forceArrow.renderOrder = 28;
  forceArrow.line.renderOrder = 28;
  forceArrow.cone.renderOrder = 29;
  forceArrow.line.material.transparent = true;
  forceArrow.line.material.depthWrite = false;
  forceArrow.cone.material.transparent = true;
  forceArrow.cone.material.depthWrite = false;
  forceArrow.line.raycast = () => {};
  forceArrow.cone.raycast = () => {};
  forceArrow.raycast = () => {};
  const probeHud = createFloatingHudLabel({ worldScale: S * 11 });
  probeHud.sprite.position.set(0, 0.22 * S, 0);
  probeHud.sprite.renderOrder = 29;
  probeHud.sprite.frustumCulled = false;
  probe.add(probeHalo, probeCore, probeHit, forceArrow, probeHud.sprite);
  probe.frustumCulled = false;
  probeGroup.frustumCulled = false;
  [probe, probeCore, probeHalo, probeHit].forEach((node) => {
    node.userData.interactive = true;
    node.userData.role = 'induced_e_probe';
  });
  probeGroup.add(probe);

  // Axis ticks.
  const axisMat = new THREE.LineBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.78 });
  const axisPts = new Float32Array([
    -4.6 * S, 0.004, 0, 4.6 * S, 0.004, 0,
    0, 0.004, -4.6 * S, 0, 0.004, 4.6 * S,
  ]);
  const axisGeo = new THREE.BufferGeometry();
  axisGeo.setAttribute('position', new THREE.BufferAttribute(axisPts, 3));
  labelGroup.add(new THREE.LineSegments(axisGeo, axisMat));

  let lastRegionR = -1;
  let lastSense = '';
  let lastShowB = null;
  let lastShowE = null;
  let lastShowProbe = null;

  root.userData.update = (data, dt = 0) => {
    const R = Math.max(0.2, Number(data?.R || 2));
    const rWorld = R * S;
    const B = Number(data?.B || 0);
    const dBdt = Number(data?.dBdt || 0);
    const sense = data?.sense || inducedESense(dBdt);
    const absB = Math.abs(B);
    const absD = Math.abs(dBdt);
    const showB = data?.showB !== false;
    const showE = data?.showE === true || (data?.auto === true && data?.showE !== false);
    const showSpin = data?.showParticles !== false;
    const showProbe = data?.showProbe !== false;

    if (Math.abs(rWorld - lastRegionR) > 1e-5) {
      lastRegionR = rWorld;
      region.scale.set(rWorld, 1, rWorld);
      regionTop.scale.set(rWorld, rWorld, 1);
      regionBottom.scale.set(rWorld, rWorld, 1);
      regionRim.scale.set(rWorld, rWorld, 1);
      // Force B lattice re-layout when the cylinder radius changes.
      bLastR = NaN;
    }

    // B field (Faraday): fixed length + continuous density breathing with |B|.
    if (!showB) {
      if (lastShowB !== false) {
        for (let i = 0; i < bArrows.length; i += 1) bArrows[i].visible = false;
        bArrowGroup.visible = false;
      }
      lastShowB = false;
    } else {
      bArrowGroup.visible = true;
      if (lastShowB !== true) {
        bLastB = NaN;
        bLastSign = 0;
        bLastR = NaN;
      }
      lastShowB = true;
      const { color, strength } = applyBFieldLayout(B, R);
      regionMat.color.setHex(color);
      regionCapMat.color.setHex(color);
      regionRim.material.color.setHex(color);
      regionRim.material.emissive.setHex(color);
      regionRim.material.emissiveIntensity = absB < 0.02 ? 0.28 : 0.9 + strength * 0.75;
      regionMat.opacity = absB < 0.02
        ? 0.18
        : 0.28 + strength * 0.2;
    }

    // E rings: style + spin; tangent arrows keep fixed length (opacity encodes |E|).
    eGroup.visible = showE;
    if (showE) {
      const eColor = sense === 'ccw' ? 0xa78bfa : sense === 'cw' ? 0xf472b6 : 0x64748b;
      const eOpacityBase = sense === 'none'
        ? 0.22
        : THREE.MathUtils.lerp(0.52, 0.98, THREE.MathUtils.clamp(absD / 2.2, 0, 1));
      const eAtR = Math.max(1e-9, inducedEMagnitude(R, R, dBdt));
      const maxMag = Math.max(1e-6, eAtR || absD * R * 0.5);
      // Angular rate ∝ |E|/r (constant inside B region; falls ~1/r² outside).
      // Positive rotation.y is CCW when looking from +y.
      const dirSign = sense === 'ccw' ? 1 : sense === 'cw' ? -1 : 0;
      const baseAng = 0.16 + THREE.MathUtils.clamp(absD / 2.5, 0, 1) * 0.4;
      const stepDt = Math.max(0, Number(dt || 0));
      const canSpin = showSpin && sense !== 'none' && absD > 1e-4 && (data?.auto !== false && !data?.paused);

      const dynamicRadii = computeInducedFieldRingRadii(R, dBdt);

      eRings.forEach(({ ring, line, mat, markers }, index) => {
        if (index >= dynamicRadii.length || absD < 0.02) {
          ring.visible = false;
          return;
        }
        ring.visible = true;

        const sourceR = dynamicRadii[index];
        const rWorld = sourceR * S;
        const mag = inducedEMagnitude(sourceR, R, dBdt);
        line.scale.set(rWorld, 1, rWorld);

        const isInside = sourceR <= R + 1e-4;
        const ringColor = isInside
          ? (sense === 'cw' ? 0xf472b6 : sense === 'ccw' ? 0xa78bfa : 0xec4899)
          : (sense === 'cw' ? 0xc084fc : sense === 'ccw' ? 0x818cf8 : 0x64748b);
        mat.color.setHex(ringColor);

        // 场线与箭头保持高对比度清晰明亮，避免外圈被过度半透明化
        const relStrength = THREE.MathUtils.clamp(mag / maxMag, 0, 1);
        mat.opacity = eOpacityBase * THREE.MathUtils.lerp(0.65, 0.95, relStrength);

        const arrowScale = THREE.MathUtils.lerp(0.80, 1.10, relStrength);

        markers.forEach(({ marker, phase }) => {
          if (sense === 'none' || mag < 1e-5) {
            marker.visible = false;
            return;
          }
          marker.visible = true;

          const lx = Math.cos(phase) * rWorld;
          const lz = Math.sin(phase) * rWorld;
          marker.position.set(lx, 0.12 * S, lz);

          const dir = inducedEDirection(Math.cos(phase), Math.sin(phase), sense);
          _tangentDir.set(dir.x, 0, dir.z);
          if (_tangentDir.lengthSq() > 1e-12) marker.setDirection(_tangentDir);
          
          marker.scale.set(arrowScale, arrowScale, arrowScale);
          marker.setColor(ringColor);
          if (marker.line?.material) {
            marker.line.material.color?.setHex?.(ringColor);
            marker.line.material.opacity = THREE.MathUtils.lerp(0.70, 0.98, relStrength);
          }
          if (marker.cone?.material) {
            marker.cone.material.color?.setHex?.(ringColor);
            marker.cone.material.opacity = THREE.MathUtils.lerp(0.75, 1.0, relStrength);
          }
        });

        if (canSpin) {
          const CONSTANT_SPIN_SPEED = 0.22; // 始终保持不变的转速 (revolutions/s)
          ring.rotation.y += dirSign * CONSTANT_SPIN_SPEED * stepDt * Math.PI * 2;
        }
      });
    }
    if (showE !== lastShowE) {
      eGroup.visible = showE;
      lastShowE = showE;
    }
    lastSense = sense;

    // Probe
    probeGroup.visible = showProbe;
    if (showProbe) {
      const px = Number(data?.probe?.x || 0) * S;
      const pz = Number(data?.probe?.z || 0) * S;
      probe.position.set(px, 0.16 * S, pz);
      const q0 = Number(data?.probe?.q0 || 1);
      const qPos = q0 >= 0;
      probeCore.material.color.setHex(qPos ? 0xffd43b : 0x60a5fa);
      probeCore.material.emissive.setHex(qPos ? 0xffb000 : 0x2563eb);
      probeHalo.material.color.setHex(qPos ? 0xffd43b : 0x60a5fa);
      const pr = Number(data?.probeR ?? Math.hypot(Number(data?.probe?.x || 0), Number(data?.probe?.z || 0)));
      const fx = Number(data?.force?.x || 0);
      const fz = Number(data?.force?.z || 0);
      const fMag = Math.hypot(fx, fz);
      const eText = showE
        ? `|E| = ${formatPhysicsNumber(data?.magnitudeE, { digits: 2, unit: 'N/C' })}`
        : '|E| = 0.00 N/C';
      const fText = showE && fMag > 1e-6 ? `|F| = ${formatPhysicsNumber(fMag, { digits: 2, unit: 'N' })}` : null;
      const q0Num = Math.abs(q0) < 1e-6 ? 0 : q0;
      const q0Sign = q0Num > 0 ? '+' : '';
      const q0Text = `q₀ = ${q0Sign}${q0Num.toFixed(1)} μC`;

      probeHud.setQE(
        q0Text,
        eText,
        '#38bdf8',
        `r = ${pr.toFixed(2)} m`,
        fText,
      );

      if (showE && fMag > 1e-5) {
        forceArrow.visible = true;
        forceArrow.setDirection(new THREE.Vector3(fx / fMag, 0, fz / fMag));
        // Length is created fixed — never call setLength.
        const fColor = qPos ? 0x4ade80 : 0x38bdf8;
        forceArrow.setColor(fColor);
        if (forceArrow.line?.material) forceArrow.line.material.color?.setHex?.(fColor);
        if (forceArrow.cone?.material) forceArrow.cone.material.color?.setHex?.(fColor);
      } else {
        forceArrow.visible = false;
      }
    }
    if (showProbe !== lastShowProbe) {
      probeGroup.visible = showProbe;
      lastShowProbe = showProbe;
    }

    // Interactive raycast gate (re-applied by setMode, kept safe here).
    const interactive = root.visible;
    [probe, probeCore, probeHalo, probeHit].forEach((node) => {
      node.userData.interactive = interactive;
    });
  };

  root.userData.setInteractive = (on) => {
    const raycast = on ? THREE.Mesh.prototype.raycast : () => {};
    root.traverse((child) => {
      if (child.userData?.role === 'induced_e_probe') {
        if (child.isMesh) {
          child.raycast = raycast;
          child.userData.interactive = !!on;
        }
      } else if (child.isMesh || child.isLine || child.isLineSegments || child.isSprite) {
        child.raycast = () => {};
      }
    });
  };

  return root;
}
